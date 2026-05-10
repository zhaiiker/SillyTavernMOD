/**
 * STC-MOD WeChat iLink Bot Protocol - QR Code Login
 *
 * Flow:
 *   1. GET /ilink/bot/get_bot_qrcode?bot_type=3 → { qrcode, qrcode_img_content }
 *   2. Poll GET /ilink/bot/get_qrcode_status?qrcode=<id>
 *      → pending / scanned / confirmed (with bot_token + baseurl) / expired
 */
import { ilinkGet } from './client.js';
import { BOT_TYPE } from './types.js';

/**
 * Request a new login QR code from iLink.
 * @returns {Promise<{ qrcode: string, qrCodeImageBase64: string }>}
 */
export async function getLoginQrCode() {
    const data = await ilinkGet('/ilink/bot/get_bot_qrcode', { bot_type: BOT_TYPE }, {
        timeoutMs: 15000,
    });

    return {
        qrcode: data.qrcode,
        qrCodeImageBase64: data.qrcode_img_content || '',
    };
}

/**
 * @typedef {Object} QrStatusResult
 * @property {'pending'|'scanned'|'confirmed'|'expired'} status
 * @property {string} [botToken] - Present only when confirmed
 * @property {string} [baseUrl] - Present only when confirmed
 */

/**
 * Check the current status of a QR code login attempt.
 * @param {string} qrcode - The qrcode identifier from getLoginQrCode()
 * @returns {Promise<QrStatusResult>}
 */
export async function getQrCodeStatus(qrcode) {
    const data = await ilinkGet('/ilink/bot/get_qrcode_status', { qrcode }, {
        timeoutMs: 10000,
    });

    // Normalize the various possible response shapes
    const status = data.status || 'pending';

    if (status === 'confirmed') {
        return {
            status: 'confirmed',
            botToken: data.bot_token,
            baseUrl: data.baseurl || data.base_url || undefined,
        };
    }

    return { status };
}
