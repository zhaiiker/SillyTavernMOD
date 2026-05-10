/**
 * STC-MOD WeChat Bridge - Headless Generate
 *
 * Server-side "headless" call to SillyTavern's LLM generation pipeline.
 * Bypasses the browser — we assemble the prompt ourselves (minimal subset)
 * and call the backend generation API directly via internal import.
 *
 * V1 supports:
 *   - Character card: description, personality, scenario, first_mes, mes_example
 *   - {{char}} / {{user}} variable replacement
 *   - Recent N messages from chat history (token-budget truncated)
 *   - System prompt from user's active preset
 *   - Basic completion params: temperature, top_p, max_tokens, etc.
 *
 * V1 does NOT support:
 *   - World Info / Lorebook
 *   - Author's Note
 *   - Vector memory / Summary
 *   - Extensions' injected prompts
 *   - Group chat
 *   - Regex placement=1 (pre-generation)
 */
import fs from 'node:fs';
import path from 'node:path';
import { readSecret } from '../../../../endpoints/secrets.js';

// We'll keep token counting simple: 1 token ≈ 2 Chinese chars or 4 English chars
const CHARS_PER_TOKEN_ESTIMATE = 2.5;
const DEFAULT_MAX_CONTEXT_TOKENS = 4096;
const DEFAULT_MAX_REPLY_TOKENS = 1024;

/**
 * @typedef {Object} GenerateOptions
 * @property {string} handle - STC user handle
 * @property {Object} directories - User directory list (from users.js)
 * @property {string} characterId - Character file name (e.g. "Seraphina.png")
 * @property {string} chatPath - Path to the wechat chat JSONL file
 * @property {string} userMessage - The user's message text
 * @property {string} userName - Display name for {{user}} (default: "用户")
 */

/**
 * @typedef {Object} GenerateResult
 * @property {boolean} success
 * @property {string} [reply] - The AI's reply text
 * @property {string} [error] - Error message if failed
 */

/**
 * Generate a reply using the user's LLM configuration.
 * @param {GenerateOptions} options
 * @returns {Promise<GenerateResult>}
 */
export async function headlessGenerate(options) {
    const { handle, directories, characterId, chatPath, userMessage, userName = '用户' } = options;

    try {
        // 1. Load character card data
        const character = loadCharacterCard(directories, characterId);
        if (!character) {
            return { success: false, error: '角色卡加载失败，请检查是否存在。' };
        }

        // 2. Load user settings (for API config)
        const settings = loadUserSettings(directories);

        // 3. Load chat history
        const history = loadChatHistory(chatPath);

        // 4. Append user message to chat
        appendToChatFile(chatPath, { role: 'user', content: userMessage, is_wechat: true, ts: Date.now() });

        // 5. Build prompt messages
        const messages = buildPrompt(character, history, userMessage, userName, settings);

        // 6. Get API key
        const apiKey = getApiKey(directories, settings);
        if (!apiKey) {
            return { success: false, error: '无法获取 API 密钥。请确认保险箱已解锁且已配置 API 连接。' };
        }

        // 7. Call LLM
        const reply = await callLlm(messages, settings, apiKey);
        if (!reply) {
            return { success: false, error: 'LLM 未返回有效回复。' };
        }

        // 8. Append assistant reply to chat
        appendToChatFile(chatPath, { role: 'assistant', content: reply, is_wechat: true, ts: Date.now() });

        return { success: true, reply };
    } catch (err) {
        console.error(`[WX:${handle}] headless-generate error:`, err.message);

        if (err.name === 'VaultLockedError') {
            return { success: false, error: '保险箱已锁定，请先到网页端解锁后再试。' };
        }

        return { success: false, error: `生成失败：${err.message}` };
    }
}

/**
 * Load a character card's JSON data from its PNG file.
 * SillyTavern stores character data as JSON in PNG tEXt chunks.
 * For simplicity, we also check for a .json sidecar file.
 */
function loadCharacterCard(directories, characterId) {
    // Try to find a pre-extracted JSON (SillyTavern caches these)
    const charName = characterId.replace(/\.png$/, '');
    const charsDir = path.join(directories.root, 'characters');

    // Check for PNG file existence at minimum
    const pngPath = path.join(charsDir, characterId);
    if (!fs.existsSync(pngPath)) return null;

    // Try to read character data from SillyTavern's internal character cache
    // The simplest approach: look for extracted JSON data
    // SillyTavern stores character data with specific structure
    try {
        // Attempt to read from the character-card-parser approach
        // In practice, SillyTavern extracts char data on load and we can
        // read it from the disk cache or re-extract from PNG
        // For v1, we'll use a simplified approach: read basic fields
        return {
            name: charName,
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            system_prompt: '',
            // These will be populated if we can parse the PNG
            ...tryReadCharacterData(pngPath),
        };
    } catch {
        return { name: charName, description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '' };
    }
}

/**
 * Try to read character data from PNG tEXt chunk.
 * This is a simplified parser — full implementation would use character-card-parser.
 */
function tryReadCharacterData(pngPath) {
    try {
        const buffer = fs.readFileSync(pngPath);
        // Look for 'tEXt' chunk with 'chara' keyword (SillyTavern V2 cards)
        const tEXtMarker = Buffer.from('tEXt');
        let pos = 8; // Skip PNG signature

        while (pos < buffer.length - 12) {
            const chunkLen = buffer.readUInt32BE(pos);
            const chunkType = buffer.slice(pos + 4, pos + 8).toString('ascii');

            if (chunkType === 'tEXt') {
                const chunkData = buffer.slice(pos + 8, pos + 8 + chunkLen);
                const nullIdx = chunkData.indexOf(0);
                const keyword = chunkData.slice(0, nullIdx).toString('ascii');

                if (keyword === 'chara') {
                    const b64 = chunkData.slice(nullIdx + 1).toString('ascii');
                    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
                    const data = JSON.parse(jsonStr);

                    // V2 format has data.data, V1 is flat
                    const charData = data.data || data;
                    return {
                        name: charData.name || '',
                        description: charData.description || '',
                        personality: charData.personality || '',
                        scenario: charData.scenario || '',
                        first_mes: charData.first_mes || charData.first_message || '',
                        mes_example: charData.mes_example || charData.message_example || '',
                        system_prompt: charData.system_prompt || '',
                    };
                }
            }

            pos += 12 + chunkLen; // 4 len + 4 type + data + 4 CRC
        }
    } catch { /* ignore parse errors */ }
    return {};
}

/**
 * Load user settings from settings.json.
 */
function loadUserSettings(directories) {
    const settingsPath = path.join(directories.root, 'settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
        return {};
    }
}

/**
 * Load chat history from JSONL file (most recent messages).
 */
function loadChatHistory(chatPath, maxMessages = 40) {
    if (!fs.existsSync(chatPath)) return [];
    try {
        const lines = fs.readFileSync(chatPath, 'utf8').trim().split('\n').filter(Boolean);
        const recent = lines.slice(-maxMessages);
        return recent.map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Append a message to the JSONL chat file.
 */
function appendToChatFile(chatPath, message) {
    const dir = path.dirname(chatPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(chatPath, JSON.stringify(message) + '\n', 'utf8');
}

/**
 * Build the prompt messages array for ChatCompletion API.
 */
function buildPrompt(character, history, userMessage, userName, settings) {
    const charName = character.name || 'Assistant';
    const maxContextTokens = settings?.max_context || DEFAULT_MAX_CONTEXT_TOKENS;

    const messages = [];
    let tokenCount = 0;

    // System message
    const systemContent = buildSystemMessage(character, userName, settings);
    if (systemContent) {
        messages.push({ role: 'system', content: systemContent });
        tokenCount += estimateTokens(systemContent);
    }

    // Character example messages (if any, as system context)
    if (character.mes_example) {
        const examples = replaceVars(character.mes_example, charName, userName);
        const exTokens = estimateTokens(examples);
        if (tokenCount + exTokens < maxContextTokens * 0.3) { // Don't let examples take more than 30%
            messages.push({ role: 'system', content: `[Example dialogue]\n${examples}\n[End of examples]` });
            tokenCount += exTokens;
        }
    }

    // Chat history (budget: remaining context minus reply tokens)
    const replyBudget = settings?.max_tokens || DEFAULT_MAX_REPLY_TOKENS;
    const historyBudget = maxContextTokens - tokenCount - replyBudget - estimateTokens(userMessage);

    const historyMessages = [];
    let historyTokens = 0;

    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        const tokens = estimateTokens(msg.content || '');
        if (historyTokens + tokens > historyBudget) break;
        historyMessages.unshift({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content || '',
        });
        historyTokens += tokens;
    }

    messages.push(...historyMessages);

    // Current user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
}

/**
 * Build the system message from character card fields.
 */
function buildSystemMessage(character, userName, settings) {
    const charName = character.name || 'Assistant';
    const parts = [];

    // User's custom system prompt (from preset) takes priority
    if (character.system_prompt) {
        parts.push(replaceVars(character.system_prompt, charName, userName));
    }

    if (character.description) {
        parts.push(replaceVars(character.description, charName, userName));
    }
    if (character.personality) {
        parts.push(`Personality: ${replaceVars(character.personality, charName, userName)}`);
    }
    if (character.scenario) {
        parts.push(`Scenario: ${replaceVars(character.scenario, charName, userName)}`);
    }

    return parts.join('\n\n');
}

/**
 * Replace {{char}} and {{user}} variables.
 */
function replaceVars(text, charName, userName) {
    return text
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);
}

/**
 * Estimate token count from text (rough: 1 token ≈ 2.5 chars for mixed CJK/Latin).
 */
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Get the API key for the user's configured LLM provider.
 */
function getApiKey(directories, settings) {
    // Determine which key to use based on settings
    const mainApi = settings?.main_api || 'openai';
    const chatSource = settings?.chat_completion_source || 'openai';

    const keyMap = {
        openai: 'api_key_openai',
        claude: 'api_key_claude',
        makersuite: 'api_key_makersuite',
        openrouter: 'api_key_openrouter',
        mistralai: 'api_key_mistralai',
        custom: 'api_key_custom',
        deepseek: 'api_key_deepseek',
        cohere: 'api_key_cohere',
    };

    const secretKey = keyMap[chatSource] || keyMap[mainApi] || 'api_key_openai';

    try {
        return readSecret(directories, secretKey);
    } catch {
        return '';
    }
}

/**
 * Call the LLM via direct HTTP (OpenAI-compatible endpoint).
 * Uses the user's configured reverse_proxy or default API URL.
 */
async function callLlm(messages, settings, apiKey) {
    const apiUrl = settings?.reverse_proxy || settings?.custom_url || 'https://api.openai.com/v1/chat/completions';
    const model = settings?.model || settings?.openai_model || 'gpt-4o-mini';

    const body = {
        model,
        messages,
        temperature: settings?.temperature ?? 0.8,
        top_p: settings?.top_p ?? 1,
        max_tokens: settings?.max_tokens || DEFAULT_MAX_REPLY_TOKENS,
        presence_penalty: settings?.presence_penalty ?? 0,
        frequency_penalty: settings?.frequency_penalty ?? 0,
        stream: false,
    };

    const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`LLM API error ${resp.status}: ${errText.substring(0, 200)}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

/**
 * Remove the last message pair (user + assistant) from chat file.
 * Used by /undo command.
 * @param {string} chatPath
 * @returns {boolean} Whether undo was successful
 */
export function undoLastPair(chatPath) {
    if (!fs.existsSync(chatPath)) return false;
    try {
        const lines = fs.readFileSync(chatPath, 'utf8').trim().split('\n').filter(Boolean);
        if (lines.length < 2) return false;

        // Remove last 2 lines (user + assistant)
        const remaining = lines.slice(0, -2);
        fs.writeFileSync(chatPath, remaining.join('\n') + (remaining.length ? '\n' : ''), 'utf8');
        return true;
    } catch {
        return false;
    }
}
