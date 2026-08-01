/**
 * SillyTavernchat Module - Password Management Routes
 * Allows OAuth users to set a password for username/password login.
 */
import express from 'express';
import storage from 'node-persist';
import { toKey, getPasswordSalt, getPasswordHash, getAccountVersion } from '../../../users.js';
import { getUserMeta, setUserMeta } from '../../user-metadata.js';

export const router = express.Router();

/**
 * Check current user's password status
 * GET /api/stc/users/password-status
 */
router.get('/password-status', async (request, response) => {
    try {
        const handle = request.user?.profile?.handle;
        if (!handle) {
            return response.status(401).send({ error: 'Not authenticated' });
        }

        // Get user from official storage
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).send({ error: 'User not found' });
        }

        // Check metadata for registration method
        const meta = getUserMeta(handle) || {};
        const hasPassword = typeof meta.hasPassword === 'boolean'
            ? meta.hasPassword
            : !!(user.password && user.password.length > 0);

        return response.json({
            hasPassword,
            registrationMethod: meta.oauthProvider || 'local',
        });
    } catch (error) {
        console.error('[STC-MOD] Password status check error:', error);
        return response.status(500).send({ error: 'Internal server error' });
    }
});

/**
 * Set or update password for current user
 * POST /api/stc/users/set-password
 * Body: { password: string, oldPassword?: string }
 */
router.post('/set-password', async (request, response) => {
    try {
        const handle = request.user?.profile?.handle;
        if (!handle) {
            return response.status(401).send({ error: 'Not authenticated' });
        }

        const { password, oldPassword } = request.body;

        // Validate new password
        if (!password || typeof password !== 'string') {
            return response.status(400).send({
                success: false,
                error: '请提供新密码',
            });
        }

        if (password.length < 8) {
            return response.status(400).send({
                success: false,
                error: '密码长度至少需要 8 个字符',
            });
        }

        // Get user from official storage
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).send({
                success: false,
                error: '用户不存在',
            });
        }

        // OAuth-only accounts carry a random internal password guard so they
        // cannot be accessed through password login. It is not a user-chosen
        // password and may be replaced without asking for the unknown guard.
        const meta = getUserMeta(handle) || {};
        const hasExistingPassword = typeof meta.hasPassword === 'boolean'
            ? meta.hasPassword
            : !!(user.password && user.password.length > 0);
        if (hasExistingPassword) {
            if (!oldPassword) {
                return response.status(400).send({
                    success: false,
                    error: '修改密码需要提供当前密码',
                });
            }

            // Verify old password
            const oldHash = getPasswordHash(oldPassword, user.salt);
            if (oldHash !== user.password) {
                return response.status(401).send({
                    success: false,
                    error: '当前密码不正确',
                });
            }
        }

        // Generate new salt and hash
        const newSalt = getPasswordSalt();
        const newHash = getPasswordHash(password, newSalt);

        // Update user in official storage
        user.password = newHash;
        user.salt = newSalt;
        await storage.setItem(toKey(handle), user);

        // Keep current session valid after password/salt change (matches users-private change-password)
        if (request.session && request.session.handle === handle) {
            request.session.version = getAccountVersion(user);
        }

        // Update metadata to mark password as set
        setUserMeta(handle, {
            hasPassword: true,
            passwordSetAt: Date.now(),
            registrationMethod: meta.oauthProvider || meta.registrationMethod || 'local',
        });

        console.info(`[STC-MOD] Password ${hasExistingPassword ? 'updated' : 'set'} for user:`, handle);

        return response.json({
            success: true,
            message: hasExistingPassword ? '密码修改成功' : '密码设置成功',
        });
    } catch (error) {
        console.error('[STC-MOD] Set password error:', error);
        return response.status(500).send({
            success: false,
            error: '服务器错误，请稍后重试',
        });
    }
});

/**
 * Verify password for current user (used when changing password)
 * POST /api/stc/users/verify-password
 * Body: { password: string }
 */
router.post('/verify-password', async (request, response) => {
    try {
        const handle = request.user?.profile?.handle;
        if (!handle) {
            return response.status(401).send({ error: 'Not authenticated' });
        }

        const { password } = request.body;

        if (!password) {
            return response.status(400).send({
                success: false,
                error: '请提供密码',
            });
        }

        // Get user from official storage
        const user = await storage.getItem(toKey(handle));
        if (!user) {
            return response.status(404).send({
                success: false,
                error: '用户不存在',
            });
        }

        // Check if user has a password
        if (!user.password || user.password.length === 0) {
            return response.status(400).send({
                success: false,
                error: '账户未设置密码',
            });
        }

        // Verify password
        const hash = getPasswordHash(password, user.salt);
        const isValid = hash === user.password;

        return response.json({
            success: true,
            valid: isValid,
        });
    } catch (error) {
        console.error('[STC-MOD] Verify password error:', error);
        return response.status(500).send({
            success: false,
            error: '服务器错误，请稍后重试',
        });
    }
});
