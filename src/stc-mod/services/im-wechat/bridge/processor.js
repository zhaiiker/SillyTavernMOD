/**
 * STC-MOD WeChat Bridge - Message Processor
 *
 * The main processing pipeline for inbound WeChat messages.
 * Receives raw WeixinMessage objects from the worker pool,
 * routes them through: rate-limit → pre-checks → command/LLM → sanitize → send.
 */
import { MESSAGE_ITEM_TYPE, MESSAGE_TYPE } from '../protocol/types.js';
import { sendTextMessage, sendTextChunks, sendTyping } from '../protocol/sender.js';
import { isRateLimited } from './rate-limiter.js';
import { getSession, updateContextToken, setSessionCharacter, clearSession, getOrCreateChatPath } from './sessions.js';
import { getBinding, incrementStat } from './bindings.js';
import { parseCommand } from './command-parser.js';
import { headlessGenerate, undoLastPair } from './headless-generate.js';
import { sanitizeForWechat } from './render-sanitizer.js';
import { chunkMessage } from './message-chunker.js';
import { getWorker } from '../workers/pool.js';
import { getStcConfig } from '../../../config.js';
import { isUserExpired } from '../../../user-metadata.js';

/**
 * Process a batch of inbound messages for a user.
 * Called by the worker pool's onMessages callback.
 * @param {string} handle - STC user handle
 * @param {import('../protocol/types.js').WeixinMessage[]} msgs
 * @param {Object} context
 * @param {Object} context.directories - User directory list
 */
export async function processMessages(handle, msgs, context) {
    const binding = getBinding(handle);
    if (!binding) return;

    const worker = getWorker(handle);
    if (!worker || worker.status === 'suspended') return;

    for (const msg of msgs) {
        // Only process inbound user messages (type=1)
        if (msg.message_type !== MESSAGE_TYPE.USER) continue;

        try {
            await processSingleMessage(handle, msg, binding, context);
        } catch (err) {
            console.error(`[WX:${handle}] processor error:`, err.message);
            incrementStat(handle, 'failed');
        }
    }
}

/**
 * Process a single inbound message.
 * @param {string} handle
 * @param {import('../protocol/types.js').WeixinMessage} msg
 * @param {import('../protocol/types.js').BotBinding} binding
 * @param {Object} context
 */
async function processSingleMessage(handle, msg, binding, context) {
    const { from_user_id: contactId, context_token: contextToken } = msg;
    const { directories } = context;

    // Update context_token for this contact (MUST do before any reply)
    updateContextToken(handle, contactId, contextToken);
    incrementStat(handle, 'inbound');

    // --- Pre-checks ---

    // 1. Rate limit
    if (isRateLimited(contactId)) {
        // Only reply once per burst (don't spam rate-limit messages)
        return;
    }

    // 2. Account expiry
    if (isUserExpired(handle)) {
        await replyText(binding, contactId, contextToken, '⏰ 您的账号已过期，请到网页端续费后继续使用。');
        return;
    }

    // 3. Extract text from message
    const text = extractText(msg);
    if (text === null) {
        // Non-text message types
        const typeLabel = getTypeLabel(msg);
        await replyText(binding, contactId, contextToken, `📎 收到${typeLabel}（当前版本仅支持文字消息）`);
        return;
    }

    if (!text.trim()) return; // Empty text, ignore

    // --- Command or LLM ---

    const session = getSession(handle, contactId, binding.activeCharacterId);
    const charName = session.characterId ? session.characterId.replace(/\.png$/, '') : '';

    // Try to parse as command
    const cmdResult = parseCommand(text, {
        handle,
        currentCharId: session.characterId,
        currentCharName: charName,
        userDataRoot: directories.root,
    });

    if (cmdResult.isCommand) {
        // Handle command actions
        if (cmdResult.action === 'switch_char' && cmdResult.characterId) {
            setSessionCharacter(handle, contactId, cmdResult.characterId);
        } else if (cmdResult.action === 'new_session') {
            clearSession(handle, contactId);
        } else if (cmdResult.action === 'undo') {
            const chatPath = session.chatPath;
            if (chatPath) undoLastPair(chatPath);
        }

        if (cmdResult.reply) {
            await replyText(binding, contactId, contextToken, cmdResult.reply);
        }
        return;
    }

    // --- LLM Generation ---

    // Check character is set
    if (!session.characterId) {
        await replyText(binding, contactId, contextToken,
            '⚠ 尚未选择角色卡。请使用 /chars 查看可用角色，然后 /use <名称> 选择。');
        return;
    }

    // Start typing indicator
    const typingInterval = startTypingLoop(binding, contactId);

    try {
        // Resolve chat path
        const chatPath = getOrCreateChatPath(handle, contactId, charName, directories.root);

        // Generate
        const result = await headlessGenerate({
            handle,
            directories,
            characterId: session.characterId,
            chatPath,
            userMessage: text,
            userName: '用户',
        });

        // Stop typing
        clearInterval(typingInterval);

        if (!result.success) {
            await replyText(binding, contactId, contextToken, `❌ ${result.error}`);
            incrementStat(handle, 'failed');
            return;
        }

        // Sanitize and send
        const sanitized = sanitizeForWechat(result.reply);
        const chunks = chunkMessage(sanitized);

        await sendTextChunks({
            botToken: binding.botToken,
            toUserId: contactId,
            contextToken,
            chunks,
            baseUrl: binding.botBaseUrl,
            delayBetweenMs: 300,
        });

        incrementStat(handle, 'outbound');
    } catch (err) {
        clearInterval(typingInterval);
        console.error(`[WX:${handle}] LLM pipeline error:`, err.message);
        await replyText(binding, contactId, contextToken, `❌ 生成出错：${err.message.substring(0, 100)}`);
        incrementStat(handle, 'failed');
    }
}

/**
 * Send a simple text reply.
 */
async function replyText(binding, contactId, contextToken, text) {
    try {
        await sendTextMessage({
            botToken: binding.botToken,
            toUserId: contactId,
            contextToken,
            text,
            baseUrl: binding.botBaseUrl,
        });
        incrementStat(binding.handle || '', 'outbound');
    } catch (err) {
        console.error('[WX] replyText failed:', err.message);
    }
}

/**
 * Start a periodic typing indicator loop.
 * @returns {NodeJS.Timeout}
 */
function startTypingLoop(binding, contactId) {
    const enabled = getStcConfig('wechat.typing.enabled', true);
    if (!enabled) return null;

    const intervalMs = getStcConfig('wechat.typing.intervalMs', 3000);

    // Send immediately once
    sendTyping({ botToken: binding.botToken, toUserId: contactId, baseUrl: binding.botBaseUrl });

    // Then every N seconds
    return setInterval(() => {
        sendTyping({ botToken: binding.botToken, toUserId: contactId, baseUrl: binding.botBaseUrl });
    }, intervalMs);
}

/**
 * Extract text from a WeixinMessage.
 * Returns null if message is not a text type (or voice with ASR).
 * @param {import('../protocol/types.js').WeixinMessage} msg
 * @returns {string|null}
 */
function extractText(msg) {
    if (!msg.item_list || msg.item_list.length === 0) return null;

    const item = msg.item_list[0];

    switch (item.type) {
        case MESSAGE_ITEM_TYPE.TEXT:
            return item.text_item?.text || '';
        case MESSAGE_ITEM_TYPE.VOICE:
            // Use ASR transcription if available
            return item.voice_item?.text || null;
        default:
            return null;
    }
}

/**
 * Get a human-readable label for a non-text message type.
 */
function getTypeLabel(msg) {
    if (!msg.item_list || msg.item_list.length === 0) return '未知消息';
    const type = msg.item_list[0].type;
    switch (type) {
        case MESSAGE_ITEM_TYPE.IMAGE: return '图片';
        case MESSAGE_ITEM_TYPE.VOICE: return '语音';
        case MESSAGE_ITEM_TYPE.FILE: return '文件';
        case MESSAGE_ITEM_TYPE.VIDEO: return '视频';
        default: return '未知消息';
    }
}
