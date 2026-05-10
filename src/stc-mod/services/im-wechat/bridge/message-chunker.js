/**
 * STC-MOD WeChat Bridge - Message Chunker
 *
 * Splits long text into chunks that fit WeChat's message size limits.
 * WeChat text messages have a practical limit of ~4000 characters.
 * Splits on paragraph boundaries when possible.
 */

const MAX_CHUNK_LENGTH = 3800; // Leave some margin below 4000
const MIN_CHUNK_LENGTH = 200;  // Don't create tiny trailing chunks

/**
 * Split a long text into chunks suitable for WeChat.
 * @param {string} text - The text to split
 * @param {number} [maxLen=3800] - Maximum characters per chunk
 * @returns {string[]} Array of chunks (1 element if text is short enough)
 */
export function chunkMessage(text, maxLen = MAX_CHUNK_LENGTH) {
    if (!text) return [''];
    if (text.length <= maxLen) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLen) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a paragraph break (double newline)
        let splitAt = findSplitPoint(remaining, maxLen, '\n\n');

        // Fallback: split at single newline
        if (splitAt < MIN_CHUNK_LENGTH) {
            splitAt = findSplitPoint(remaining, maxLen, '\n');
        }

        // Fallback: split at sentence end (。！？.!?)
        if (splitAt < MIN_CHUNK_LENGTH) {
            splitAt = findSplitPoint(remaining, maxLen, /[。！？.!?]/);
        }

        // Fallback: split at space
        if (splitAt < MIN_CHUNK_LENGTH) {
            splitAt = findSplitPoint(remaining, maxLen, ' ');
        }

        // Last resort: hard cut at maxLen
        if (splitAt < MIN_CHUNK_LENGTH) {
            splitAt = maxLen;
        }

        chunks.push(remaining.substring(0, splitAt).trim());
        remaining = remaining.substring(splitAt).trim();
    }

    return chunks.filter(c => c.length > 0);
}

/**
 * Find the best split point within maxLen, searching backwards from maxLen
 * for the given delimiter.
 * @param {string} text
 * @param {number} maxLen
 * @param {string|RegExp} delimiter
 * @returns {number} Position to split at, or 0 if delimiter not found
 */
function findSplitPoint(text, maxLen, delimiter) {
    const searchRegion = text.substring(0, maxLen);

    if (typeof delimiter === 'string') {
        const lastIdx = searchRegion.lastIndexOf(delimiter);
        return lastIdx > 0 ? lastIdx + delimiter.length : 0;
    }

    // RegExp: find last match
    let lastIdx = 0;
    let match;
    const globalRegex = new RegExp(delimiter.source, 'g');
    while ((match = globalRegex.exec(searchRegion)) !== null) {
        lastIdx = match.index + match[0].length;
    }
    return lastIdx;
}
