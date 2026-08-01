/**
 * SillyTavernchat Module - Configuration
 * Reads custom config values from config.yaml under the 'stcMod' namespace.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

let cachedConfig = null;
let configMtime = 0;

function getConfigPath() {
    return path.join(process.cwd(), 'config.yaml');
}

function loadFullConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) return {};
    try {
        const stat = fs.statSync(configPath);
        if (cachedConfig && stat.mtimeMs === configMtime) return cachedConfig;
        const raw = fs.readFileSync(configPath, 'utf8');
        cachedConfig = yaml.parse(raw) || {};
        configMtime = stat.mtimeMs;
        return cachedConfig;
    } catch (e) {
        console.error('[STC-MOD] Failed to read config.yaml:', e.message);
        return {};
    }
}

/**
 * Get a STC-MOD specific config value.
 * Looks under config.yaml keys directly (e.g. 'enableForum', 'oauth.github.enabled', etc.)
 * @param {string} key Dot-separated key path
 * @param {*} defaultValue Default value if key not found
 * @returns {*}
 */
export function getStcConfig(key, defaultValue = undefined) {
    const config = loadFullConfig();
    const parts = key.split('.');
    let current = config;
    for (const part of parts) {
        if (current == null || typeof current !== 'object') return defaultValue;
        current = current[part];
    }
    return current !== undefined ? current : defaultValue;
}

/**
 * Set a config value and save to config.yaml
 * @param {string} key Dot-separated key path
 * @param {*} value Value to set
 */
export function setStcConfig(key, value) {
    const config = loadFullConfig();
    const parts = key.split('.');
    let current = config;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    try {
        const configPath = getConfigPath();
        fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
        cachedConfig = config;
    } catch (e) {
        console.error('[STC-MOD] Failed to write config.yaml:', e.message);
    }
}

/**
 * Ensure default STC config values exist in config.yaml
 */
export function ensureDefaultConfig() {
    const defaults = {
        enableInvitationCodes: false,
        enableForum: false,
        enablePublicCharacters: false,
        purchaseLink: '',
        oauth: {
            github: { enabled: false, clientId: '', clientSecret: '', callbackUrl: '' },
            discord: { enabled: false, clientId: '', clientSecret: '', callbackUrl: '' },
            linuxdo: {
                enabled: false, clientId: '', clientSecret: '', callbackUrl: '',
                authUrl: 'https://connect.linux.do/oauth2/authorize',
                tokenUrl: 'https://connect.linux.do/oauth2/token',
                userInfoUrl: 'https://connect.linux.do/api/user',
            },
        },
        email: {
            enabled: false,
            smtp: { host: '', port: 587, secure: false, user: '', password: '' },
            from: '',
            fromName: 'SillyTavern',
            siteUrl: '',
        },
        userStorage: {
            enabled: false,
            defaultLimitMiB: 500,
            dailyCheckInMiB: 0,
        },
        privacy: {
            secretsVault: {
                requireForApiKeys: true,
                unlockTtlMinutes: 1440,
            },
        },
        deployment: {
            // 反向代理信任设置（手动配置，无自动探测）。
            // false = 不信任任何反代（默认，本地 HTTP 直连用）；
            // 1 = 单层反代（nginx/OpenResty/Caddy）；
            // 2 = 双层（例如 Cloudflare + 自建反代）；
            // 'cloudflare' = 仅信任 Cloudflare IP 段并使用 CF-Connecting-IP 取真实访客 IP；
            // true = 信任全部跳数（不推荐）。
            trustProxy: false,
        },
        rateLimiting: {
            stc: {
                registration: { points: 5, durationSeconds: 600 },
                verificationIp: { points: 10, durationSeconds: 3600 },
                verificationEmail: { points: 3, durationSeconds: 900 },
                oauthStart: { points: 20, durationSeconds: 600 },
                oauthCallback: { points: 30, durationSeconds: 600 },
                oauthComplete: { points: 5, durationSeconds: 600 },
                renewal: { points: 5, durationSeconds: 600 },
            },
        },
    };

    const config = loadFullConfig();
    let changed = false;

    function mergeDefaults(target, source, prefix = '') {
        for (const [key, val] of Object.entries(source)) {
            if (target[key] === undefined) {
                target[key] = val;
                changed = true;
            } else if (val && typeof val === 'object' && !Array.isArray(val) && typeof target[key] === 'object') {
                mergeDefaults(target[key], val, `${prefix}${key}.`);
            }
        }
    }

    mergeDefaults(config, defaults);

    if (changed) {
        try {
            const configPath = getConfigPath();
            fs.writeFileSync(configPath, yaml.stringify(config), 'utf8');
            cachedConfig = config;
            console.log('[STC-MOD] Default configuration values added to config.yaml');
        } catch (e) {
            console.error('[STC-MOD] Failed to save default config:', e.message);
        }
    }
}

export function getDataRoot() {
    return globalThis.DATA_ROOT || path.join(process.cwd(), 'data');
}

export function getStcDataDir() {
    const dir = path.join(getDataRoot(), 'stc-mod');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
