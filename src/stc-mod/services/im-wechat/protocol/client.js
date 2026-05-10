/**
 * STC-MOD WeChat iLink Bot Protocol - HTTP Client
 *
 * Handles the three-tuple authentication:
 *   AuthorizationType: ilink_bot_token
 *   X-WECHAT-UIN: base64(String(randomUint32()))  — changes every request
 *   Authorization: Bearer <bot_token>              — after login
 */
import crypto from 'node:crypto';
import { ILINK_BASE_URL } from './types.js';

/**
 * Generate a random X-WECHAT-UIN header value.
 * Format: base64(String(randomUint32()))
 * @returns {string}
 */
function generateWechatUin() {
    const uint32 = crypto.randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32)).toString('base64');
}

/**
 * Build the standard iLink request headers.
 * @param {string} [botToken] - Bot token (omit for pre-login requests like QR)
 * @returns {Record<string, string>}
 */
function buildHeaders(botToken) {
    const headers = {
        'Content-Type': 'application/json',
        'AuthorizationType': 'ilink_bot_token',
        'X-WECHAT-UIN': generateWechatUin(),
    };
    if (botToken) {
        headers['Authorization'] = `Bearer ${botToken}`;
    }
    return headers;
}

/**
 * Custom error for iLink API failures.
 */
export class IlinkError extends Error {
    /**
     * @param {string} message
     * @param {number} httpStatus
     * @param {number} [ret] - iLink ret code from response body
     * @param {Object} [body] - Full response body
     */
    constructor(message, httpStatus, ret, body) {
        super(message);
        this.name = 'IlinkError';
        this.httpStatus = httpStatus;
        this.ret = ret;
        this.body = body;
    }
}

/**
 * Make a GET request to iLink API.
 * @param {string} path - Relative path (e.g. "/ilink/bot/get_bot_qrcode")
 * @param {Record<string, string>} [params] - Query parameters
 * @param {Object} [options]
 * @param {string} [options.botToken]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs=15000]
 * @returns {Promise<any>}
 */
export async function ilinkGet(path, params = {}, options = {}) {
    const { botToken, baseUrl = ILINK_BASE_URL, timeoutMs = 15000 } = options;
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url.toString(), {
            method: 'GET',
            headers: buildHeaders(botToken),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new IlinkError(
                `iLink GET ${path} failed: HTTP ${resp.status}`,
                resp.status, undefined, text,
            );
        }

        return await resp.json();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Make a POST request to iLink API.
 * @param {string} path - Relative path
 * @param {Object} body - JSON body
 * @param {Object} [options]
 * @param {string} [options.botToken]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs=40000] - Default higher for long-polling
 * @returns {Promise<any>}
 */
export async function ilinkPost(path, body, options = {}) {
    const { botToken, baseUrl = ILINK_BASE_URL, timeoutMs = 40000 } = options;
    const url = new URL(path, baseUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url.toString(), {
            method: 'POST',
            headers: buildHeaders(botToken),
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        if (resp.status === 401) {
            throw new IlinkError('Bot token invalid or expired', 401);
        }

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new IlinkError(
                `iLink POST ${path} failed: HTTP ${resp.status}`,
                resp.status, undefined, text,
            );
        }

        const data = await resp.json();

        // iLink uses ret=0 for success in some endpoints
        if (data.ret !== undefined && data.ret !== 0) {
            throw new IlinkError(
                `iLink POST ${path} returned ret=${data.ret}`,
                resp.status, data.ret, data,
            );
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}
