/**
 * STC-MOD WeChat Bridge - Worker Runner Type & Utilities
 *
 * A "runner" is the runtime state object for a single user's long-polling worker.
 * This file provides the type definition and helper utilities.
 */

/**
 * @typedef {Object} WorkerRunner
 * @property {string} handle - STC user handle
 * @property {import('../protocol/long-poller.js').LongPoller} poller
 * @property {'connected'|'reconnecting'|'disconnected'|'token_invalid'|'suspended'} status
 * @property {number} lastPolledAt - Timestamp of last successful poll cycle
 * @property {number} startedAt - Timestamp when worker was started
 */

/**
 * Check if a runner is in a healthy state (can process messages).
 * @param {WorkerRunner} runner
 * @returns {boolean}
 */
export function isRunnerHealthy(runner) {
    return runner.status === 'connected';
}

/**
 * Check if a runner is suspended (vault locked, expired, etc.).
 * @param {WorkerRunner} runner
 * @returns {boolean}
 */
export function isRunnerSuspended(runner) {
    return runner.status === 'suspended';
}

/**
 * Get human-readable status label for a runner.
 * @param {WorkerRunner} runner
 * @returns {string}
 */
export function getRunnerStatusLabel(runner) {
    switch (runner.status) {
        case 'connected': return '已连接';
        case 'reconnecting': return '重连中';
        case 'disconnected': return '已断开';
        case 'token_invalid': return 'Token 失效';
        case 'suspended': return '已挂起';
        default: return '未知';
    }
}

/**
 * Calculate how long since last successful poll.
 * @param {WorkerRunner} runner
 * @returns {number} Milliseconds since last poll
 */
export function getTimeSinceLastPoll(runner) {
    return Date.now() - runner.lastPolledAt;
}
