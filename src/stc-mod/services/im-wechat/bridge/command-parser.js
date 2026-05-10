/**
 * STC-MOD WeChat Bridge - Command Parser
 *
 * Handles slash commands sent via WeChat:
 *   /help   - Show available commands
 *   /chars  - List available character cards
 *   /use <name> - Switch to a character card
 *   /new    - Start new conversation (clear context)
 *   /who    - Show current active character
 *   /undo   - Remove last message pair
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} CommandResult
 * @property {boolean} isCommand - Whether the input was recognized as a command
 * @property {string} [reply] - Text reply to send back (if isCommand)
 * @property {string} [action] - Action to take: 'switch_char' | 'new_session' | 'undo'
 * @property {string} [characterId] - For 'switch_char' action
 */

const HELP_TEXT = `📋 微信 Bot 指令帮助

/help   - 显示本帮助
/chars  - 列出可用角色卡
/use <名称> - 切换角色卡（支持模糊匹配）
/new    - 清空当前对话上下文
/who    - 查看当前激活的角色卡
/undo   - 撤销上一轮对话

💡 不带 / 前缀的消息会直接发送给 AI 角色。`;

/**
 * Parse a command from user text.
 * @param {string} text - Raw user input
 * @param {Object} context
 * @param {string} context.handle - STC user handle
 * @param {string} context.currentCharId - Currently active character ID
 * @param {string} context.currentCharName - Currently active character name
 * @param {string} context.userDataRoot - User data directory
 * @returns {CommandResult}
 */
export function parseCommand(text, context) {
    const trimmed = text.trim();

    // Not a command
    if (!trimmed.startsWith('/')) {
        return { isCommand: false };
    }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();

    switch (cmd) {
        case '/help':
        case '/h':
            return { isCommand: true, reply: HELP_TEXT };

        case '/who':
            return {
                isCommand: true,
                reply: context.currentCharName
                    ? `🎭 当前角色：${context.currentCharName}`
                    : '⚠ 尚未选择角色卡。使用 /chars 查看可用角色，/use <名称> 切换。',
            };

        case '/chars': {
            const page = parseInt(args) || 1;
            const reply = listCharacters(context.userDataRoot, page);
            return { isCommand: true, reply };
        }

        case '/use': {
            if (!args) {
                return { isCommand: true, reply: '⚠ 请指定角色名称。用法：/use <名称关键字>' };
            }
            const result = findCharacter(context.userDataRoot, args);
            if (result.error) {
                return { isCommand: true, reply: result.error };
            }
            if (result.candidates) {
                const list = result.candidates.map((c, i) => `  ${i + 1}. ${c.name}`).join('\n');
                return { isCommand: true, reply: `🔍 匹配到多个角色，请更精确指定：\n${list}` };
            }
            return {
                isCommand: true,
                action: 'switch_char',
                characterId: result.characterId,
                reply: `✅ 已切换到角色：${result.name}\n对话上下文已清空，开始新对话。`,
            };
        }

        case '/new':
            return {
                isCommand: true,
                action: 'new_session',
                reply: '🔄 对话上下文已清空，开始新的对话。',
            };

        case '/undo':
            return {
                isCommand: true,
                action: 'undo',
                reply: '↩️ 已撤销上一轮对话。',
            };

        default:
            return { isCommand: true, reply: `❓ 未知指令：${cmd}\n输入 /help 查看可用指令。` };
    }
}

/**
 * List character cards for a user.
 * @param {string} userDataRoot
 * @param {number} page
 * @returns {string}
 */
function listCharacters(userDataRoot, page = 1) {
    const chars = getCharacterList(userDataRoot);
    if (chars.length === 0) {
        return '📭 没有找到可用的角色卡。请先在网页端创建或导入角色卡。';
    }

    const perPage = 20;
    const totalPages = Math.ceil(chars.length / perPage);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * perPage;
    const slice = chars.slice(start, start + perPage);

    let reply = `📋 角色卡列表（第 ${safePage}/${totalPages} 页，共 ${chars.length} 个）\n\n`;
    reply += slice.map((c, i) => `  ${start + i + 1}. ${c.name}`).join('\n');

    if (totalPages > 1) {
        reply += `\n\n💡 翻页：/chars ${safePage + 1}`;
    }
    reply += '\n\n使用 /use <名称> 切换角色';
    return reply;
}

/**
 * Find a character by fuzzy name match.
 * @param {string} userDataRoot
 * @param {string} query
 * @returns {{ characterId?: string, name?: string, candidates?: {name:string}[], error?: string }}
 */
function findCharacter(userDataRoot, query) {
    const chars = getCharacterList(userDataRoot);
    if (chars.length === 0) {
        return { error: '📭 没有可用的角色卡。' };
    }

    const lowerQuery = query.toLowerCase();

    // Exact match first
    const exact = chars.find(c => c.name.toLowerCase() === lowerQuery);
    if (exact) return { characterId: exact.id, name: exact.name };

    // Substring match
    const matches = chars.filter(c => c.name.toLowerCase().includes(lowerQuery));

    if (matches.length === 0) {
        return { error: `❌ 未找到包含「${query}」的角色卡。使用 /chars 查看完整列表。` };
    }
    if (matches.length === 1) {
        return { characterId: matches[0].id, name: matches[0].name };
    }
    if (matches.length <= 5) {
        return { candidates: matches };
    }
    return { error: `🔍 匹配到 ${matches.length} 个角色，请输入更精确的名称。` };
}

/**
 * Get all character cards for a user by scanning their characters directory.
 * @param {string} userDataRoot
 * @returns {{ id: string, name: string }[]}
 */
function getCharacterList(userDataRoot) {
    const charsDir = path.join(userDataRoot, 'characters');
    if (!fs.existsSync(charsDir)) return [];

    try {
        const files = fs.readdirSync(charsDir).filter(f => f.endsWith('.png'));
        return files.map(f => ({
            id: f,
            name: f.replace(/\.png$/, ''),
        }));
    } catch {
        return [];
    }
}
