/**
 * STC-MOD WeChat Bridge - Worker Pool
 *
 * Manages the lifecycle of per-user long-polling workers:
 *   - Start / stop workers by handle
 *   - Enforce max concurrent worker limit
 *   - Auto-start all enabled bindings on server boot
 *   - Graceful shutdown on process exit
 *
 * Each "worker" is one LongPoller instance bound to a user's bot_token,
 * plus a message handler that feeds inbound messages to the bridge processor.
 */
import { LongPoller } from '../protocol/long-poller.js';
import { getStcConfig } from '../../../config.js';

/** @type {Map<string, import('./runner.js').WorkerRunner>} */
const activeWorkers = new Map();

/**
 * Get the configured maximum number of concurrent workers.
 * @returns {number}
 */
function getMaxWorkers() {
    return getStcConfig('wechat.maxConcurrentWorkers', 50);
}

/**
 * Check if a worker is running for a given handle.
 * @param {string} handle
 * @returns {boolean}
 */
export function isWorkerRunning(handle) {
    const w = activeWorkers.get(handle);
    return !!(w && w.poller && w.poller.isRunning);
}

/**
 * Get the worker runner for a handle (if exists).
 * @param {string} handle
 * @returns {import('./runner.js').WorkerRunner|undefined}
 */
export function getWorker(handle) {
    return activeWorkers.get(handle);
}

/**
 * Get status summary of all active workers.
 * @returns {{ handle: string, status: string, lastPolledAt: number }[]}
 */
export function getWorkerStatuses() {
    const results = [];
    for (const [handle, runner] of activeWorkers) {
        results.push({
            handle,
            status: runner.status,
            lastPolledAt: runner.lastPolledAt,
        });
    }
    return results;
}

/**
 * Get overall pool stats.
 * @returns {{ activeCount: number, maxCount: number }}
 */
export function getPoolStats() {
    return {
        activeCount: activeWorkers.size,
        maxCount: getMaxWorkers(),
    };
}

/**
 * Start a worker for a user.
 * @param {string} handle - STC user handle
 * @param {Object} params
 * @param {string} params.botToken - Decrypted bot token
 * @param {string} [params.baseUrl] - iLink base URL override
 * @param {string} [params.cursor] - Saved get_updates_buf cursor
 * @param {function} params.onMessages - Callback: (handle, msgs: WeixinMessage[]) => void
 * @param {function} [params.onTokenInvalid] - Callback when token expires
 * @param {function} [params.onError] - Callback for non-fatal errors
 * @returns {{ success: boolean, reason?: string }}
 */
export function startWorker(handle, { botToken, baseUrl, cursor, onMessages, onTokenInvalid, onError }) {
    // Already running?
    if (isWorkerRunning(handle)) {
        return { success: true, reason: 'already_running' };
    }

    // Pool full?
    if (activeWorkers.size >= getMaxWorkers()) {
        return { success: false, reason: 'pool_full' };
    }

    const poller = new LongPoller({ botToken, baseUrl });
    if (cursor) {
        poller.cursor = cursor;
    }

    const runner = {
        handle,
        poller,
        status: 'connected',
        lastPolledAt: Date.now(),
        startedAt: Date.now(),
    };

    // Wire events
    poller.on('messages', (msgs) => {
        runner.lastPolledAt = Date.now();
        try {
            onMessages(handle, msgs);
        } catch (err) {
            console.error(`[WX:${handle}] Error in message handler:`, err.message);
        }
    });

    poller.on('error', (err) => {
        runner.status = 'reconnecting';
        console.warn(`[WX:${handle}] Poller error (will retry):`, err.message);
        if (onError) onError(handle, err);
    });

    poller.on('token_invalid', () => {
        runner.status = 'token_invalid';
        console.error(`[WX:${handle}] Bot token invalid, stopping worker.`);
        activeWorkers.delete(handle);
        if (onTokenInvalid) onTokenInvalid(handle);
    });

    poller.on('stopped', () => {
        if (runner.status !== 'token_invalid') {
            runner.status = 'disconnected';
        }
    });

    // Start
    activeWorkers.set(handle, runner);
    poller.start();
    runner.status = 'connected';

    console.log(`[WX:${handle}] Worker started (pool: ${activeWorkers.size}/${getMaxWorkers()})`);
    return { success: true };
}

/**
 * Stop a worker for a user.
 * @param {string} handle
 * @returns {string|null} The cursor at time of stop (for persistence), or null if not found
 */
export function stopWorker(handle) {
    const runner = activeWorkers.get(handle);
    if (!runner) return null;

    const cursor = runner.poller.cursor;
    runner.poller.stop();
    activeWorkers.delete(handle);

    console.log(`[WX:${handle}] Worker stopped (pool: ${activeWorkers.size}/${getMaxWorkers()})`);
    return cursor;
}

/**
 * Stop all workers. Called during graceful shutdown.
 */
export function stopAllWorkers() {
    console.log(`[WX] Stopping all workers (${activeWorkers.size} active)...`);
    for (const [handle, runner] of activeWorkers) {
        runner.poller.stop();
        console.log(`[WX:${handle}] Worker stopped (shutdown).`);
    }
    activeWorkers.clear();
}

/**
 * Suspend a worker (keep polling but mark as suspended).
 * Used when vault is locked or account expired — we still poll to keep the
 * connection alive but won't process messages normally.
 * @param {string} handle
 */
export function suspendWorker(handle) {
    const runner = activeWorkers.get(handle);
    if (runner) {
        runner.status = 'suspended';
    }
}

/**
 * Resume a suspended worker.
 * @param {string} handle
 */
export function resumeWorker(handle) {
    const runner = activeWorkers.get(handle);
    if (runner && runner.status === 'suspended') {
        runner.status = 'connected';
    }
}

// Graceful shutdown hook
process.on('SIGTERM', stopAllWorkers);
process.on('SIGINT', stopAllWorkers);
