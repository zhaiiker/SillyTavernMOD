/**
 * STC-MOD WeChat Bridge - Session Manager
 *
 * Tracks per-contact conversation state:
 *   - Which character card is active for this contact
 *   - The chat file path
 *   - The latest context_token (MUST be echoed in replies)
 *   - Last message timestamp
 *
 * Sessions are kept in memory with periodic flush to disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getStcDataDir } from '../../../config.js';

/** @type {Map<string, Map<string, import('../protocol/types.js').WechatSession>>} handle → (contactId → session) */
const sessionCache = new Map();

const SESSIONS_FILE = 'wechat-sessions.json';
const CONTEXT_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get the sessions file path.
 * @returns {string}
 */
function getSessionsPath() {
    return path.join(getStcDataDir(), SESSIONS_FILE);
}

/**
 * Load sessions from disk into memory.
 */
export function loadSessions() {
    const filePath = getSessionsPath();
    if (!fs.existsSync(filePath)) return;

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const [handle, contacts] of Object.entries(data)) {
            const contactMap = new Map();
            for (const [contactId, session] of Object.entries(contacts)) {
                contactMap.set(contactId, session);
            }
            sessionCache.set(handle, contactMap);
        }
        console.log(`[WX] Loaded ${sessionCache.size} user sessions from disk.`);
    } catch (err) {
        console.error('[WX] Failed to load sessions:', err.message);
    }
}

/**
 * Persist sessions to disk.
 */
export function saveSessions() {
    const filePath = getSessionsPath();
    const data = {};
    for (const [handle, contacts] of sessionCache) {
        data[handle] = Object.fromEntries(contacts);
    }

    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error('[WX] Failed to save sessions:', err.message);
    }
}

/**
 * Get or create a session for a contact.
 * @param {string} handle
 * @param {string} contactId - from_user_id
 * @param {string} [defaultCharId] - Default character to use if new session
 * @returns {import('../protocol/types.js').WechatSession}
 */
export function getSession(handle, contactId, defaultCharId = '') {
    if (!sessionCache.has(handle)) {
        sessionCache.set(handle, new Map());
    }
    const contacts = sessionCache.get(handle);

    if (!contacts.has(contactId)) {
        const session = {
            characterId: defaultCharId,
            chatPath: '',
            contextToken: '',
            contextTokenAt: 0,
            lastMessageAt: 0,
        };
        contacts.set(contactId, session);
    }

    return contacts.get(contactId);
}

/**
 * Update the context_token for a contact session.
 * @param {string} handle
 * @param {string} contactId
 * @param {string} contextToken
 */
export function updateContextToken(handle, contactId, contextToken) {
    const session = getSession(handle, contactId);
    session.contextToken = contextToken;
    session.contextTokenAt = Date.now();
    session.lastMessageAt = Date.now();
}

/**
 * Get a valid context_token for replying.
 * Returns empty string if token is expired (> 10 min).
 * @param {string} handle
 * @param {string} contactId
 * @returns {string}
 */
export function getReplyContextToken(handle, contactId) {
    const session = getSession(handle, contactId);
    if (!session.contextToken) return '';
    if (Date.now() - session.contextTokenAt > CONTEXT_TOKEN_TTL_MS) return '';
    return session.contextToken;
}

/**
 * Set the active character for a contact session.
 * @param {string} handle
 * @param {string} contactId
 * @param {string} characterId
 */
export function setSessionCharacter(handle, contactId, characterId) {
    const session = getSession(handle, contactId);
    session.characterId = characterId;
    // Reset chat path when character changes — new conversation
    session.chatPath = '';
}

/**
 * Get or generate the chat file path for this session.
 * @param {string} handle
 * @param {string} contactId
 * @param {string} charName - Character name (for directory)
 * @param {string} userDataRoot - e.g. data/<handle>
 * @returns {string}
 */
export function getOrCreateChatPath(handle, contactId, charName, userDataRoot) {
    const session = getSession(handle, contactId);
    if (session.chatPath) return session.chatPath;

    // Generate a stable short hash from contactId
    const hash = crypto.createHash('sha256').update(contactId).digest('hex').substring(0, 8);
    const chatDir = path.join(userDataRoot, 'chats', charName);

    if (!fs.existsSync(chatDir)) {
        fs.mkdirSync(chatDir, { recursive: true });
    }

    session.chatPath = path.join(chatDir, `wechat__${hash}.jsonl`);
    return session.chatPath;
}

/**
 * Clear session for a contact (used by /new command).
 * Keeps the characterId but resets chat path and context.
 * @param {string} handle
 * @param {string} contactId
 */
export function clearSession(handle, contactId) {
    const session = getSession(handle, contactId);
    session.chatPath = '';
    session.contextToken = '';
    session.contextTokenAt = 0;
}

/**
 * Remove all sessions for a handle (used on unbind).
 * @param {string} handle
 */
export function removeAllSessions(handle) {
    sessionCache.delete(handle);
}

// Auto-save every 2 minutes
setInterval(saveSessions, 2 * 60 * 1000).unref();
