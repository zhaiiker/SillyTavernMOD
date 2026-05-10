/**
 * STC-MOD WeChat iLink Bot Protocol - Type Definitions (JSDoc)
 *
 * All types here mirror the iLink HTTP/JSON API fields as documented in the
 * @tencent-weixin/openclaw-weixin@1.0.2 source analysis.
 */

/**
 * @typedef {Object} IlinkHeaders
 * @property {'application/json'} Content-Type
 * @property {'ilink_bot_token'} AuthorizationType
 * @property {string} X-WECHAT-UIN - base64(String(randomUint32())), changes every request
 * @property {string} [Authorization] - "Bearer <bot_token>", only after login
 */

/**
 * @typedef {Object} QrCodeResponse
 * @property {string} qrcode - QR code identifier for status polling
 * @property {string} qrcode_img_content - Base64 encoded QR image (PNG)
 */

/**
 * @typedef {'pending'|'scanned'|'confirmed'|'expired'} QrCodeStatus
 */

/**
 * @typedef {Object} QrCodeStatusResponse
 * @property {QrCodeStatus} status
 * @property {string} [bot_token] - Only present when status === 'confirmed'
 * @property {string} [baseurl] - Only present when status === 'confirmed'
 */

/**
 * @typedef {Object} TextItem
 * @property {string} text
 */

/**
 * @typedef {Object} ImageItem
 * @property {string} cdn_url
 * @property {string} aes_key - Base64 encoded AES-128 key for ECB decryption
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} VoiceItem
 * @property {string} cdn_url
 * @property {string} aes_key
 * @property {string} [text] - ASR transcription (if available)
 * @property {number} [duration_ms]
 */

/**
 * @typedef {Object} FileItem
 * @property {string} cdn_url
 * @property {string} aes_key
 * @property {string} file_name
 * @property {number} file_size
 */

/**
 * @typedef {Object} VideoItem
 * @property {string} cdn_url
 * @property {string} aes_key
 * @property {number} [duration_ms]
 */

/**
 * Message item types:
 * 1 = text, 2 = image, 3 = voice, 4 = file, 5 = video
 * @typedef {Object} MessageItem
 * @property {1|2|3|4|5} type
 * @property {TextItem} [text_item]
 * @property {ImageItem} [image_item]
 * @property {VoiceItem} [voice_item]
 * @property {FileItem} [file_item]
 * @property {VideoItem} [video_item]
 */

/**
 * message_type:
 *   1 = user message (inbound from wechat user)
 *   2 = bot message (outbound from bot)
 *
 * message_state:
 *   2 = FINISH (complete message)
 *
 * @typedef {Object} WeixinMessage
 * @property {string} from_user_id - e.g. "o9cq800kum_xxx@im.wechat"
 * @property {string} to_user_id - e.g. "e06c1ceea05e@im.bot"
 * @property {1|2} message_type
 * @property {number} message_state
 * @property {string} context_token - MUST be echoed back in reply
 * @property {MessageItem[]} item_list
 * @property {string} [group_id] - Present for group messages
 */

/**
 * @typedef {Object} GetUpdatesResponse
 * @property {number} ret - 0 = success
 * @property {WeixinMessage[]} [msgs]
 * @property {string} get_updates_buf - Cursor for next poll
 * @property {number} [longpolling_timeout_ms]
 */

/**
 * @typedef {Object} SendMessagePayload
 * @property {Object} msg
 * @property {string} msg.to_user_id
 * @property {2} msg.message_type - Always 2 (bot message)
 * @property {2} msg.message_state - Always 2 (FINISH)
 * @property {string} msg.context_token
 * @property {MessageItem[]} msg.item_list
 */

/**
 * @typedef {Object} BotBinding
 * @property {string|Object} botToken - Encrypted via privacy vault
 * @property {string} botBaseUrl
 * @property {string} botId - e.g. "xxx@im.bot"
 * @property {string} [botDisplayName]
 * @property {string} activeCharacterId
 * @property {number} createdAt
 * @property {number} lastPolledAt
 * @property {'connected'|'disconnected'|'token_invalid'|'suspended'} status
 * @property {{ inbound: number, outbound: number, failed: number }} stats
 */

/**
 * @typedef {Object} WechatSession
 * @property {string} characterId
 * @property {string} chatPath
 * @property {string} contextToken
 * @property {number} contextTokenAt
 * @property {number} lastMessageAt
 */

export const MESSAGE_ITEM_TYPE = {
    TEXT: 1,
    IMAGE: 2,
    VOICE: 3,
    FILE: 4,
    VIDEO: 5,
};

export const MESSAGE_TYPE = {
    USER: 1,
    BOT: 2,
};

export const MESSAGE_STATE = {
    FINISH: 2,
};

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CHANNEL_VERSION = '1.0.2';
export const BOT_TYPE = 3;
