/**
 * STC-MOD WeChat Bridge - Per-Contact Rate Limiter
 *
 * Sliding window rate limiter to prevent abuse.
 * Default: 20 messages per 60 seconds per contact.
 */
import { getStcConfig } from '../../../config.js';

/** @type {Map<string, number[]>} contactId → array of timestamps */
const windows = new Map();

/**
 * Check if a message from this contact should be rate-limited.
 * @param {string} contactId - The from_user_id
 * @returns {boolean} true if the message should be BLOCKED
 */
export function isRateLimited(contactId) {
    const windowSec = getStcConfig('wechat.perContactRateLimit.windowSec', 60);
    const maxMessages = getStcConfig('wechat.perContactRateLimit.maxMessages', 20);

    const now = Date.now();
    const cutoff = now - (windowSec * 1000);

    let timestamps = windows.get(contactId);
    if (!timestamps) {
        timestamps = [];
        windows.set(contactId, timestamps);
    }

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
    }

    if (timestamps.length >= maxMessages) {
        return true; // BLOCKED
    }

    // Record this message
    timestamps.push(now);
    return false;
}

/**
 * Clean up stale entries periodically.
 * Call this every few minutes to prevent memory leak from abandoned contacts.
 */
export function cleanupStaleEntries() {
    const windowSec = getStcConfig('wechat.perContactRateLimit.windowSec', 60);
    const cutoff = Date.now() - (windowSec * 1000 * 2); // 2x window for safety

    for (const [contactId, timestamps] of windows) {
        if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
            windows.delete(contactId);
        }
    }
}

// Auto-cleanup every 5 minutes
setInterval(cleanupStaleEntries, 5 * 60 * 1000).unref();
