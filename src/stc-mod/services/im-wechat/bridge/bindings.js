/**
 * STC-MOD WeChat Bridge - Binding Manager
 *
 * Manages the mapping: STC handle → bot account binding.
 * Bot tokens are stored encrypted via the privacy vault mechanism.
 *
 * File: data/stc-mod/wechat-bindings.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStcDataDir } from '../../../config.js';

const BINDINGS_FILE = 'wechat-bindings.json';

/** @type {Object<string, import('../protocol/types.js').BotBinding>} */
let bindingsCache = {};

/**
 * Get the bindings file path.
 * @returns {string}
 */
function getBindingsPath() {
    return path.join(getStcDataDir(), BINDINGS_FILE);
}

/**
 * Load bindings from disk.
 */
export function loadBindings() {
    const filePath = getBindingsPath();
    if (!fs.existsSync(filePath)) {
        bindingsCache = {};
        return;
    }
    try {
        bindingsCache = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log(`[WX] Loaded ${Object.keys(bindingsCache).length} wechat bindings.`);
    } catch (err) {
        console.error('[WX] Failed to load bindings:', err.message);
        bindingsCache = {};
    }
}

/**
 * Save bindings to disk.
 */
export function saveBindings() {
    const filePath = getBindingsPath();
    try {
        fs.writeFileSync(filePath, JSON.stringify(bindingsCache, null, 2), 'utf8');
    } catch (err) {
        console.error('[WX] Failed to save bindings:', err.message);
    }
}

/**
 * Get binding for a handle.
 * @param {string} handle
 * @returns {import('../protocol/types.js').BotBinding|null}
 */
export function getBinding(handle) {
    return bindingsCache[handle] || null;
}

/**
 * Get all bindings (for admin view / startup).
 * @returns {Object<string, import('../protocol/types.js').BotBinding>}
 */
export function getAllBindings() {
    return { ...bindingsCache };
}

/**
 * Create or update a binding.
 * @param {string} handle
 * @param {import('../protocol/types.js').BotBinding} binding
 */
export function setBinding(handle, binding) {
    bindingsCache[handle] = binding;
    saveBindings();
}

/**
 * Remove a binding.
 * @param {string} handle
 */
export function removeBinding(handle) {
    delete bindingsCache[handle];
    saveBindings();
}

/**
 * Update binding status.
 * @param {string} handle
 * @param {'connected'|'disconnected'|'token_invalid'|'suspended'} status
 */
export function updateBindingStatus(handle, status) {
    if (bindingsCache[handle]) {
        bindingsCache[handle].status = status;
        saveBindings();
    }
}

/**
 * Update last polled timestamp.
 * @param {string} handle
 */
export function updateLastPolled(handle) {
    if (bindingsCache[handle]) {
        bindingsCache[handle].lastPolledAt = Date.now();
        // Don't save on every poll — too frequent. Let periodic save handle it.
    }
}

/**
 * Increment stats.
 * @param {string} handle
 * @param {'inbound'|'outbound'|'failed'} field
 * @param {number} [count=1]
 */
export function incrementStat(handle, field, count = 1) {
    if (bindingsCache[handle]) {
        if (!bindingsCache[handle].stats) {
            bindingsCache[handle].stats = { inbound: 0, outbound: 0, failed: 0 };
        }
        bindingsCache[handle].stats[field] = (bindingsCache[handle].stats[field] || 0) + count;
    }
}

/**
 * Check if wechat bridge is enabled globally.
 * @param {function} getStcConfigFn - Pass getStcConfig to avoid circular imports
 * @returns {boolean}
 */
export function isWechatEnabled(getStcConfigFn) {
    return getStcConfigFn('wechat.enabled', false);
}

// Auto-save every 2 minutes (stats accumulate without save)
setInterval(saveBindings, 2 * 60 * 1000).unref();
