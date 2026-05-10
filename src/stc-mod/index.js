// @ts-nocheck
/**
 * SillyTavernchat Module (STC-MOD) - Main Entry Point
 *
 * This is the sidecar module that provides all SillyTavernchat features
 * as a non-invasive add-on to the official SillyTavern.
 *
 * Exports 5 functions called from server-main.js hook points:
 * - shouldSkipCsrf(req)    -> CSRF exemption check
 * - setupPublicRoutes(app) -> Page routes (before login middleware)
 * - setupPublicApi(app)    -> Public API routes (no auth required)
 * - setupPrivateRoutes(app)-> Private API routes (auth required)
 */
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { ensureDefaultConfig, getStcConfig, getStcDataDir } from './config.js';
import { shouldSkipCsrf as csrfCheck } from './middleware/csrf-exemption.js';
import { expirationCheckMiddleware } from './middleware/expiration-check.js';
import { registerStorageEnforceMiddleware } from './middleware/storage-enforce.js';
import { isUserExpired } from './user-metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure default config values on load
ensureDefaultConfig();

// Ensure data directories exist
getStcDataDir();

/**
 * CSRF exemption check - called from server-main.js skipCsrfProtection
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function shouldSkipCsrf(req) {
    return csrfCheck(req);
}

/**
 * Hook B: Setup public routes and page overrides.
 * Called BEFORE the official login page route, so our routes take priority.
 * @param {import('express').Express} app
 */
export async function setupPublicRoutes(app) {
    // Serve custom login page (overrides official /login)
    const publicDir = path.join(__dirname, 'public');
    app.get('/login', (req, res, next) => {
        // If user is already logged in, skip to official handler
        if (req.session?.handle) return next();
        return res.sendFile('login.html', { root: publicDir });
    });

    // Welcome page (+ expiry enforcement for logged-in users)
    app.get('/', (req, res, next) => {
        if (req.session?.handle) {
            // If invitation code system is enabled, kick expired users back to login
            if (getStcConfig('enableInvitationCodes', false) && isUserExpired(req.session.handle)) {
                const handle = req.session.handle;
                req.session = null; // destroy session
                return res.redirect(`/login?reason=expired&handle=${encodeURIComponent(handle)}`);
            }
            return next();
        }
        return res.sendFile('welcome.html', { root: publicDir });
    });

    // Registration page
    app.get('/register', (req, res) => {
        return res.sendFile('register.html', { root: publicDir });
    });

    // Forum page (configurable)
    app.get('/forum', (req, res, next) => {
        if (!getStcConfig('enableForum', false)) return next();
        return res.sendFile('forum.html', { root: publicDir });
    });

    // Public characters page (configurable)
    app.get('/public-characters', (req, res, next) => {
        if (!getStcConfig('enablePublicCharacters', false)) return next();
        return res.sendFile('public-characters.html', { root: publicDir });
    });

    // Serve STC-MOD static assets
    app.use('/stc-assets', express.static(publicDir, { maxAge: '1d' }));

    // Storage quota enforcement – intercepts write operations before official handlers
    registerStorageEnforceMiddleware(app);

    console.log('[STC-MOD] Public routes registered.');
}

/**
 * Hook D: Setup public API routes (no authentication required).
 * Called AFTER usersPublicRouter but BEFORE requireLoginMiddleware.
 * @param {import('express').Express} app
 */
export async function setupPublicApi(app) {
    // OAuth routes
    const { router: oauthRouter } = await import('./routes/public/oauth.js');
    app.use('/api/stc/oauth', oauthRouter);

    // Registration route (calls official API internally)
    const { router: registerRouter } = await import('./routes/public/register.js');
    app.use('/api/stc/users', registerRouter);

    // Invitation codes public status
    const { router: invitationStatusRouter } = await import('./routes/public/invitation-status.js');
    app.use('/api/stc/invitation-codes', invitationStatusRouter);

    // Login page announcements
    const { router: announcementsPublicRouter } = await import('./routes/public/announcements-public.js');
    app.use('/api/stc/announcements', announcementsPublicRouter);

    // Email service status
    const { router: emailStatusRouter } = await import('./routes/public/email-status.js');
    app.use('/api/stc/email', emailStatusRouter);

    // Public config (for frontend to query enabled features)
    const { router: publicConfigRouter } = await import('./routes/public/public-config.js');
    app.use('/api/stc/public-config', publicConfigRouter);

    console.log('[STC-MOD] Public API routes registered.');
}

/**
 * Hook E: Setup private API routes (authentication required).
 * Called AFTER setupPrivateEndpoints.
 * @param {import('express').Express} app
 */
export async function setupPrivateRoutes(app) {
    // User expiration check middleware for all STC private routes
    app.use('/api/stc', expirationCheckMiddleware);

    // Invitation codes management (admin)
    const { router: invitationCodesRouter } = await import('./routes/private/invitation-codes.js');
    app.use('/api/stc/invitation-codes', invitationCodesRouter);

    // Extended user endpoints (renew, profile, etc.)
    const { router: userExtendRouter } = await import('./routes/private/user-extend.js');
    app.use('/api/stc/users', userExtendRouter);

    // Announcements management (admin)
    const { router: announcementsRouter } = await import('./routes/private/announcements.js');
    app.use('/api/stc/announcements', announcementsRouter);

    // Email configuration (admin)
    const { router: emailConfigRouter } = await import('./routes/private/email-config.js');
    app.use('/api/stc/email-config', emailConfigRouter);

    // OAuth configuration (admin)
    const { router: oauthConfigRouter } = await import('./routes/private/oauth-config.js');
    app.use('/api/stc/oauth-config', oauthConfigRouter);

    // Forum (configurable)
    if (getStcConfig('enableForum', false)) {
        const { router: forumRouter } = await import('./routes/private/forum.js');
        app.use('/api/stc/forum', forumRouter);
    }

    // Public characters library (configurable)
    if (getStcConfig('enablePublicCharacters', false)) {
        const { router: publicCharsRouter } = await import('./routes/private/public-characters.js');
        app.use('/api/stc/public-characters', publicCharsRouter);
    }

    // System monitoring (admin)
    const { router: systemLoadRouter } = await import('./routes/private/system-load.js');
    app.use('/api/stc/system-load', systemLoadRouter);

    // User storage management
    const { router: userStorageRouter } = await import('./routes/private/user-storage.js');
    app.use('/api/stc/user-storage', userStorageRouter);

    // Default config template (admin)
    const { router: defaultConfigRouter } = await import('./routes/private/default-config.js');
    app.use('/api/stc/default-config', defaultConfigRouter);

    // Scheduled tasks (admin)
    const { router: scheduledTasksRouter } = await import('./routes/private/scheduled-tasks.js');
    app.use('/api/stc/scheduled-tasks', scheduledTasksRouter);

    // Privacy vault (user API keys)
    const { router: privacyVaultRouter } = await import('./routes/private/privacy-vault.js');
    app.use('/api/stc/privacy-vault', privacyVaultRouter);

    // WeChat Bot bridge (iLink protocol)
    // Route is ALWAYS registered (like privacy-vault) so the frontend /status endpoint
    // can respond with {enabled:false} instead of 404. The route handler itself guards
    // all destructive operations behind getStcConfig('wechat.enabled').
    const { router: wechatBridgeRouter } = await import('./routes/private/wechat-bridge.js');
    app.use('/api/stc/wechat', wechatBridgeRouter);

    // Only auto-start workers if wechat is actually enabled
    if (getStcConfig('wechat.enabled', false)) {
        try {
            const { loadBindings, getAllBindings, updateBindingStatus } = await import('./services/im-wechat/bridge/bindings.js');
            const { loadSessions } = await import('./services/im-wechat/bridge/sessions.js');
            const { startWorker } = await import('./services/im-wechat/workers/pool.js');
            const { processMessages } = await import('./services/im-wechat/bridge/processor.js');
            const { getUserDirectories } = await import('../users.js');

            loadBindings();
            loadSessions();

            // Auto-start workers for all connected bindings
            const bindings = getAllBindings();
            let started = 0;
            for (const [handle, binding] of Object.entries(bindings)) {
                if (binding.status === 'connected' && binding.botToken) {
                    try {
                        const directories = getUserDirectories(handle);
                        if (!directories) continue;
                        const token = typeof binding.botToken === 'string' ? binding.botToken : '';
                        if (!token) continue;

                        startWorker(handle, {
                            botToken: token,
                            baseUrl: binding.botBaseUrl,
                            onMessages: (h, msgs) => processMessages(h, msgs, { directories }),
                            onTokenInvalid: (h) => updateBindingStatus(h, 'token_invalid'),
                            onError: () => {},
                        });
                        started++;
                    } catch (e) {
                        console.warn(`[WX:${handle}] Failed to auto-start worker:`, e.message);
                    }
                }
            }

            if (started > 0) {
                console.log(`[STC-MOD] WeChat bridge: ${started} worker(s) auto-started.`);
            }
        } catch (e) {
            console.error('[STC-MOD] WeChat bridge initialization error:', e.message);
        }
    }

    console.log('[STC-MOD] Private API routes registered.');
}
