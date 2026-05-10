/**
 * STC-MOD WeChat Bridge - Private API Routes
 *
 * All routes require authentication (registered under /api/stc/wechat/*).
 *
 * Endpoints:
 *   POST /qr/start      - Initiate QR login (returns base64 image)
 *   POST /qr/status     - Poll QR scan status
 *   GET  /status        - Current binding status for logged-in user
 *   POST /unbind        - Unbind and stop worker
 *   GET  /chars         - List user's character cards
 *   POST /set-character - Set default character for WeChat
 *   POST /test-send     - Send a test message
 *   GET  /logs          - Recent message log metadata
 */
import express from 'express';
import { getLoginQrCode, getQrCodeStatus } from '../../services/im-wechat/protocol/qr.js';
import { sendTextMessage } from '../../services/im-wechat/protocol/sender.js';
import { startWorker, stopWorker, isWorkerRunning, getPoolStats } from '../../services/im-wechat/workers/pool.js';
import { getBinding, setBinding, removeBinding, updateBindingStatus, getAllBindings } from '../../services/im-wechat/bridge/bindings.js';
import { getSession, removeAllSessions, loadSessions, saveSessions } from '../../services/im-wechat/bridge/sessions.js';
import { processMessages } from '../../services/im-wechat/bridge/processor.js';
import { getStcConfig } from '../../config.js';
import fs from 'node:fs';
import path from 'node:path';

export const router = express.Router();

/** In-memory store for pending QR login sessions */
const pendingQrSessions = new Map(); // qrId → { handle, qrcode, startedAt }

// ─── QR Login ────────────────────────────────────────────────

/**
 * POST /qr/start
 * Initiate a QR code login flow.
 */
router.post('/qr/start', async (request, response) => {
    try {
        if (!getStcConfig('wechat.enabled', false)) {
            return response.status(403).json({ error: true, message: '微信 Bot 功能未启用。' });
        }

        const handle = request.user.profile.handle;

        // Check if already bound
        const existing = getBinding(handle);
        if (existing && existing.status === 'connected') {
            return response.status(409).json({ error: true, message: '已绑定微信 Bot，请先解绑。' });
        }

        // Request QR from iLink
        const { qrcode, qrCodeImageBase64 } = await getLoginQrCode();

        // Store pending session
        const qrId = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        pendingQrSessions.set(qrId, {
            handle,
            qrcode,
            startedAt: Date.now(),
        });

        // Auto-expire after 3 minutes
        setTimeout(() => pendingQrSessions.delete(qrId), 3 * 60 * 1000);

        return response.json({
            success: true,
            qrId,
            qrImageBase64: qrCodeImageBase64,
            expiresIn: 180, // seconds
        });
    } catch (err) {
        console.error('[WX] /qr/start error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

/**
 * POST /qr/status
 * Poll the status of a pending QR login.
 */
router.post('/qr/status', async (request, response) => {
    try {
        const { qrId } = request.body;
        const handle = request.user.profile.handle;

        if (!qrId) {
            return response.status(400).json({ error: true, message: 'qrId is required.' });
        }

        const session = pendingQrSessions.get(qrId);
        if (!session) {
            return response.json({ status: 'expired' });
        }

        if (session.handle !== handle) {
            return response.status(403).json({ error: true, message: 'QR session belongs to another user.' });
        }

        // Check with iLink
        const result = await getQrCodeStatus(session.qrcode);

        if (result.status === 'confirmed' && result.botToken) {
            // Success! Create binding and start worker
            pendingQrSessions.delete(qrId);

            const binding = {
                botToken: result.botToken, // Will be encrypted by vault on next save cycle
                botBaseUrl: result.baseUrl || getStcConfig('wechat.baseUrl', 'https://ilinkai.weixin.qq.com'),
                botId: '', // Will be populated on first message
                botDisplayName: '',
                activeCharacterId: '',
                createdAt: Date.now(),
                lastPolledAt: Date.now(),
                status: 'connected',
                stats: { inbound: 0, outbound: 0, failed: 0 },
            };

            setBinding(handle, binding);

            // Start long-polling worker
            const directories = request.user.directories;
            startWorker(handle, {
                botToken: result.botToken,
                baseUrl: binding.botBaseUrl,
                onMessages: (h, msgs) => processMessages(h, msgs, { directories }),
                onTokenInvalid: (h) => updateBindingStatus(h, 'token_invalid'),
                onError: () => {},
            });

            return response.json({ status: 'confirmed' });
        }

        return response.json({ status: result.status });
    } catch (err) {
        console.error('[WX] /qr/status error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

// ─── Status & Management ─────────────────────────────────────

/**
 * GET /status
 * Get the current user's WeChat binding status.
 */
router.get('/status', (request, response) => {
    try {
        const handle = request.user.profile.handle;
        const binding = getBinding(handle);
        const enabled = getStcConfig('wechat.enabled', false);

        if (!enabled) {
            return response.json({ enabled: false, bound: false });
        }

        if (!binding) {
            return response.json({ enabled: true, bound: false });
        }

        const workerRunning = isWorkerRunning(handle);

        return response.json({
            enabled: true,
            bound: true,
            status: binding.status,
            workerRunning,
            botDisplayName: binding.botDisplayName || '(未命名)',
            botId: binding.botId ? maskId(binding.botId) : '',
            activeCharacterId: binding.activeCharacterId,
            activeCharacterName: binding.activeCharacterId ? binding.activeCharacterId.replace(/\.png$/, '') : '',
            createdAt: binding.createdAt,
            lastPolledAt: binding.lastPolledAt,
            stats: binding.stats,
        });
    } catch (err) {
        console.error('[WX] /status error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

/**
 * POST /unbind
 * Unbind the WeChat bot and stop worker.
 */
router.post('/unbind', (request, response) => {
    try {
        const handle = request.user.profile.handle;
        const { confirm } = request.body;

        if (confirm !== 'UNBIND') {
            return response.status(400).json({ error: true, message: '请确认解绑：body 需包含 {"confirm":"UNBIND"}' });
        }

        // Stop worker
        stopWorker(handle);

        // Remove binding
        removeBinding(handle);

        // Remove sessions
        removeAllSessions(handle);
        saveSessions();

        return response.json({ success: true, message: '已解绑微信 Bot。' });
    } catch (err) {
        console.error('[WX] /unbind error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

// ─── Character Management ────────────────────────────────────

/**
 * GET /chars
 * List the user's available character cards.
 */
router.get('/chars', (request, response) => {
    try {
        const directories = request.user.directories;
        const charsDir = path.join(directories.root, 'characters');

        if (!fs.existsSync(charsDir)) {
            return response.json({ characters: [] });
        }

        const files = fs.readdirSync(charsDir).filter(f => f.endsWith('.png'));
        const characters = files.map(f => ({
            id: f,
            name: f.replace(/\.png$/, ''),
        }));

        return response.json({ characters });
    } catch (err) {
        console.error('[WX] /chars error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

/**
 * POST /set-character
 * Set the default character card for WeChat conversations.
 */
router.post('/set-character', (request, response) => {
    try {
        const handle = request.user.profile.handle;
        const { characterId } = request.body;

        if (!characterId) {
            return response.status(400).json({ error: true, message: 'characterId is required.' });
        }

        const binding = getBinding(handle);
        if (!binding) {
            return response.status(404).json({ error: true, message: '未绑定微信 Bot。' });
        }

        // Verify character exists
        const directories = request.user.directories;
        const charPath = path.join(directories.root, 'characters', characterId);
        if (!fs.existsSync(charPath)) {
            return response.status(404).json({ error: true, message: '角色卡不存在。' });
        }

        binding.activeCharacterId = characterId;
        setBinding(handle, binding);

        return response.json({
            success: true,
            characterName: characterId.replace(/\.png$/, ''),
        });
    } catch (err) {
        console.error('[WX] /set-character error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

// ─── Test & Debug ────────────────────────────────────────────

/**
 * POST /test-send
 * Send a test message to verify the connection is working.
 */
router.post('/test-send', async (request, response) => {
    try {
        const handle = request.user.profile.handle;
        const { toUserId, text } = request.body;

        const binding = getBinding(handle);
        if (!binding) {
            return response.status(404).json({ error: true, message: '未绑定微信 Bot。' });
        }

        if (!toUserId) {
            return response.status(400).json({ error: true, message: 'toUserId is required (联系人 ID)。' });
        }

        const session = getSession(handle, toUserId);
        const contextToken = session?.contextToken;

        if (!contextToken) {
            return response.status(400).json({
                error: true,
                message: '没有可用的 context_token。需要先让对方给你发一条消息，才能回复。',
            });
        }

        await sendTextMessage({
            botToken: binding.botToken,
            toUserId,
            contextToken,
            text: text || '🤖 这是一条来自 SillyTavern 的测试消息。',
            baseUrl: binding.botBaseUrl,
        });

        return response.json({ success: true });
    } catch (err) {
        console.error('[WX] /test-send error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

/**
 * GET /logs
 * Get recent message log metadata (no content, just timestamps and types).
 */
router.get('/logs', (request, response) => {
    try {
        const handle = request.user.profile.handle;
        const binding = getBinding(handle);

        if (!binding) {
            return response.json({ logs: [] });
        }

        // For v1, we just return stats — full log with per-message metadata is M2
        return response.json({
            stats: binding.stats,
            lastPolledAt: binding.lastPolledAt,
            status: binding.status,
        });
    } catch (err) {
        console.error('[WX] /logs error:', err.message);
        return response.status(500).json({ error: true, message: err.message });
    }
});

// ─── Admin endpoint (for system monitoring) ──────────────────

/**
 * GET /admin/pool
 * Admin-only: get worker pool stats.
 */
router.get('/admin/pool', (request, response) => {
    try {
        // Check if admin (simple check — proper middleware would be better)
        if (!request.user?.profile?.admin) {
            return response.status(403).json({ error: true });
        }

        const pool = getPoolStats();
        return response.json(pool);
    } catch (err) {
        return response.status(500).json({ error: true, message: err.message });
    }
});

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Mask an ID for privacy display (show first 4 and last 4 chars).
 * @param {string} id
 * @returns {string}
 */
function maskId(id) {
    if (!id || id.length <= 10) return '****';
    return `${id.substring(0, 4)}****${id.substring(id.length - 4)}`;
}
