/**
 * STC-MOD WeChat iLink Bot Protocol - Message Sender
 *
 * Handles:
 *   - sendmessage (text, images in the future)
 *   - sendtyping ("正在输入" indicator)
 *   - getconfig (for typing_ticket)
 *
 * CRITICAL: Every reply MUST include the context_token from the inbound message,
 * otherwise the message won't appear in the correct conversation window.
 */
import { ilinkPost } from './client.js';
import { MESSAGE_TYPE, MESSAGE_STATE, MESSAGE_ITEM_TYPE } from './types.js';

/**
 * Send a text message to a WeChat user.
 * @param {Object} params
 * @param {string} params.botToken
 * @param {string} params.toUserId - e.g. "o9cq800kum_xxx@im.wechat"
 * @param {string} params.contextToken - MUST be from the inbound message
 * @param {string} params.text - The text content to send
 * @param {string} [params.baseUrl]
 * @returns {Promise<any>}
 */
export async function sendTextMessage({ botToken, toUserId, contextToken, text, baseUrl }) {
    return await ilinkPost('/ilink/bot/sendmessage', {
        msg: {
            to_user_id: toUserId,
            message_type: MESSAGE_TYPE.BOT,
            message_state: MESSAGE_STATE.FINISH,
            context_token: contextToken,
            item_list: [
                {
                    type: MESSAGE_ITEM_TYPE.TEXT,
                    text_item: { text },
                },
            ],
        },
    }, {
        botToken,
        baseUrl,
        timeoutMs: 15000,
    });
}

/**
 * Send multiple text chunks (for long messages that need splitting).
 * Each chunk uses the same context_token.
 * @param {Object} params
 * @param {string} params.botToken
 * @param {string} params.toUserId
 * @param {string} params.contextToken
 * @param {string[]} params.chunks - Array of text chunks
 * @param {string} [params.baseUrl]
 * @param {number} [params.delayBetweenMs=500] - Delay between chunks to avoid flooding
 * @returns {Promise<void>}
 */
export async function sendTextChunks({ botToken, toUserId, contextToken, chunks, baseUrl, delayBetweenMs = 500 }) {
    for (let i = 0; i < chunks.length; i++) {
        await sendTextMessage({ botToken, toUserId, contextToken, text: chunks[i], baseUrl });
        if (i < chunks.length - 1 && delayBetweenMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
        }
    }
}

/**
 * Send "typing" indicator to show the user that the bot is processing.
 * Should be called periodically (every 3s) while waiting for LLM response.
 * @param {Object} params
 * @param {string} params.botToken
 * @param {string} params.toUserId
 * @param {string} [params.typingTicket] - From getconfig, may be needed
 * @param {string} [params.baseUrl]
 * @returns {Promise<any>}
 */
export async function sendTyping({ botToken, toUserId, typingTicket, baseUrl }) {
    try {
        return await ilinkPost('/ilink/bot/sendtyping', {
            to_user_id: toUserId,
            typing_ticket: typingTicket || '',
        }, {
            botToken,
            baseUrl,
            timeoutMs: 5000,
        });
    } catch (err) {
        // Typing is non-critical; swallow errors
        console.debug('[WX] sendtyping failed (non-critical):', err.message);
        return null;
    }
}

/**
 * Get bot config (including typing_ticket).
 * @param {Object} params
 * @param {string} params.botToken
 * @param {string} [params.baseUrl]
 * @returns {Promise<{ typing_ticket?: string }>}
 */
export async function getBotConfig({ botToken, baseUrl }) {
    try {
        return await ilinkPost('/ilink/bot/getconfig', {}, {
            botToken,
            baseUrl,
            timeoutMs: 10000,
        });
    } catch (err) {
        console.warn('[WX] getconfig failed:', err.message);
        return {};
    }
}
