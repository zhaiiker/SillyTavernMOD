import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getIpAddress, retryAfter } from '../../express-common.js';
import { getStcConfig } from '../config.js';

const PREFER_REAL_IP_HEADER = getStcConfig('rateLimiting.preferRealIpHeader', false);

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createLimiter(name, defaultPoints, defaultDurationSeconds, keyBuilder = request => getIpAddress(request, PREFER_REAL_IP_HEADER)) {
    const points = positiveNumber(getStcConfig(`rateLimiting.stc.${name}.points`, defaultPoints), defaultPoints);
    const duration = positiveNumber(getStcConfig(`rateLimiting.stc.${name}.durationSeconds`, defaultDurationSeconds), defaultDurationSeconds);
    const limiter = new RateLimiterMemory({ points, duration, keyPrefix: `stc-${name}` });

    return async function stcRateLimit(request, response, next) {
        try {
            await limiter.consume(keyBuilder(request));
            return next();
        } catch (error) {
            if (error instanceof RateLimiterRes) {
                return retryAfter(response, error).status(429).json({
                    error: '请求过于频繁，请稍后再试',
                });
            }

            console.error(`[STC-MOD] ${name} rate limiter failed:`, error);
            return response.status(500).json({ error: '服务器错误' });
        }
    };
}

export const registrationRateLimit = createLimiter('registration', 5, 10 * 60);
export const verificationIpRateLimit = createLimiter('verificationIp', 10, 60 * 60);
export const verificationEmailRateLimit = createLimiter('verificationEmail', 3, 15 * 60, request => {
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : 'missing-email';
    return email;
});
export const oauthStartRateLimit = createLimiter('oauthStart', 20, 10 * 60);
export const oauthCallbackRateLimit = createLimiter('oauthCallback', 30, 10 * 60);
export const oauthCompleteRateLimit = createLimiter('oauthComplete', 5, 10 * 60);
export const renewalRateLimit = createLimiter('renewal', 5, 10 * 60, request => {
    const ip = getIpAddress(request, PREFER_REAL_IP_HEADER);
    const handle = request.user?.profile?.handle || request.body?.handle || 'anonymous';
    return `${ip}:${String(handle).toLowerCase()}`;
});
