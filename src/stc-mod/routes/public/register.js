/**
 * SillyTavernchat Module - Registration Route
 * Handles user registration by calling the official SillyTavern /api/users/create API internally.
 */
import express from 'express';
import crypto from 'node:crypto';
import { getStcConfig } from '../../config.js';
import { setUserMeta, findUserByEmail } from '../../user-metadata.js';
import * as invitationService from '../../services/invitation-codes.js';
import { isEmailServiceAvailable, sendVerificationCode } from '../../services/email-service.js';
import { applyTemplate, getTemplateMeta } from '../../services/default-template.js';
import { getDefaultLimitMiB, isStorageLimitEnabled } from '../../services/storage-quota.js';
import { validateRegistrationPassword } from '../../services/password-policy.js';
import { registrationRateLimit, renewalRateLimit, verificationEmailRateLimit, verificationIpRateLimit } from '../../middleware/public-rate-limit.js';

export const router = express.Router();

const verificationCodes = new Map();
const VERIFICATION_EXPIRY = 5 * 60 * 1000; // 5 minutes

function normalizeHandle(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 32) || 'user';
}

const WEAK_NAMES = ['admin', 'root', 'system', 'test', 'null', 'undefined', 'default', 'default-user'];

// Send email verification code
router.post('/send-verification', verificationIpRateLimit, verificationEmailRateLimit, async (req, res) => {
    try {
        const { email, userName } = req.body;
        if (!email || !userName) {
            return res.status(400).json({ error: '缺少必要参数' });
        }

        if (!isEmailServiceAvailable()) {
            return res.status(400).json({ error: '邮件服务未启用' });
        }

        // Check if email already registered
        if (findUserByEmail(email)) {
            return res.status(400).json({ error: '该邮箱已被注册' });
        }

        const code = crypto.randomInt(100000, 999999).toString();
        verificationCodes.set(email.toLowerCase(), {
            code,
            expiresAt: Date.now() + VERIFICATION_EXPIRY,
            userName,
        });

        const sent = await sendVerificationCode(email, code, userName);
        if (!sent) {
            return res.status(500).json({ error: '验证码发送失败' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('[STC-MOD] Send verification error:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// User registration
router.post('/register', registrationRateLimit, async (req, res) => {
    try {
        const { name, password, inviteCode, email, verificationCode } = req.body;

        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return res.status(400).json({ error: '用户名至少需要2个字符' });
        }

        const passwordValidation = validateRegistrationPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ error: passwordValidation.error });
        }

        const handle = normalizeHandle(name.trim());
        if (WEAK_NAMES.includes(handle)) {
            return res.status(400).json({ error: '该用户名不可用' });
        }

        // Validate invitation code if enabled
        if (invitationService.isEnabled()) {
            if (!inviteCode) {
                return res.status(400).json({ error: '需要邀请码' });
            }
            const validation = invitationService.validateInvitationCode(inviteCode);
            if (!validation.valid) {
                return res.status(400).json({ error: validation.reason });
            }
        }

        // Validate email verification if email service is enabled
        if (isEmailServiceAvailable() && getStcConfig('email.enabled', false)) {
            if (!email || !verificationCode) {
                return res.status(400).json({ error: '需要邮箱验证' });
            }
            const stored = verificationCodes.get(email.toLowerCase());
            if (!stored || stored.code !== verificationCode || Date.now() > stored.expiresAt) {
                return res.status(400).json({ error: '验证码无效或已过期' });
            }
            if (findUserByEmail(email)) {
                return res.status(400).json({ error: '该邮箱已被注册' });
            }
            verificationCodes.delete(email.toLowerCase());
        }

        // Call official SillyTavern user creation API internally
        // We need to create a simulated admin request to /api/users/create
        const { createUser } = await import('./register-helper.js');
        const createResult = await createUser(handle, name.trim(), password);

        if (!createResult.success) {
            return res.status(400).json({ error: createResult.error || '创建用户失败' });
        }

        // Use invitation code and calculate expiration
        let expiresAt = 0;
        if (invitationService.isEnabled() && inviteCode) {
            const useResult = invitationService.useInvitationCode(inviteCode, handle);
            if (useResult.success) {
                expiresAt = useResult.expiresAt ?? 0;
            }
        }

        // Save extended user metadata
        setUserMeta(handle, {
            email: email || null,
            expiresAt,
            createdAt: Date.now(),
            lastLoginAt: Date.now(),
            lastActiveAt: Date.now(),
            inviteCodeUsed: inviteCode || null,
            storageLimitMiB: isStorageLimitEnabled() ? getDefaultLimitMiB() : undefined,
            hasPassword: !!(password && password.length > 0),
            registrationMethod: 'local',
        });

        // Apply default template if exists
        if (getTemplateMeta()) {
            try {
                await applyTemplate(handle, { displayName: name.trim() });
            } catch (e) {
                console.error('[STC-MOD] Apply template failed:', e.message);
            }
        }

        res.json({
            success: true,
            handle,
            name: name.trim(),
            expiresAt: expiresAt === 0 ? 0 : expiresAt || undefined,
        });
    } catch (error) {
        console.error('[STC-MOD] Registration error:', error);
        res.status(500).json({ error: '注册失败，请稍后重试' });
    }
});

// Renew expired user account with new invitation code
router.post('/renew-expired', renewalRateLimit, async (req, res) => {
    try {
        const { handle, inviteCode } = req.body;
        if (!handle || !inviteCode) {
            return res.status(400).json({ error: '缺少必要参数' });
        }

        if (!invitationService.isEnabled()) {
            return res.status(400).json({ error: '邀请码系统未启用' });
        }

        const validation = invitationService.validateInvitationCode(inviteCode);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
        }

        const useResult = invitationService.useInvitationCode(inviteCode, handle);
        if (!useResult.success) {
            return res.status(400).json({ error: '邀请码使用失败' });
        }

        setUserMeta(handle, { expiresAt: useResult.expiresAt ?? 0 });

        res.json({
            success: true,
            expiresAt: useResult.expiresAt ?? 0,
        });
    } catch (error) {
        console.error('[STC-MOD] Renew expired error:', error);
        res.status(500).json({ error: '续费失败' });
    }
});
