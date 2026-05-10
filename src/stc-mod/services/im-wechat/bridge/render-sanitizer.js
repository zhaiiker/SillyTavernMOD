/**
 * STC-MOD WeChat Bridge - Render Sanitizer
 *
 * Cleans LLM output for WeChat delivery:
 *   1. Strip all HTML tags that are frontend-rendering related
 *   2. Convert basic formatting to text equivalents
 *   3. Remove Markdown images (WeChat can't render them)
 *   4. Normalize whitespace
 *
 * Design: ONLY plain text goes to WeChat. No HTML, no Markdown images,
 * no custom tags from SillyTavern Helper / 小白插件 / Tavern Regex output.
 */

/**
 * HTML tags that are always stripped (including content).
 * These are frontend-only rendering constructs.
 */
const STRIP_WITH_CONTENT = [
    'script', 'style', 'link', 'meta', 'iframe', 'object', 'embed',
    'noscript', 'canvas', 'svg',
];

/**
 * Custom tags from ST extensions that should be stripped (including content).
 */
const STRIP_CUSTOM_TAGS_WITH_CONTENT = [
    'stmod', 'stscript', 'tavern-regex',
];

/**
 * Custom tags stripped but their TEXT content is preserved.
 */
const STRIP_TAG_KEEP_TEXT = [
    'tavern-helper', 'st-helper', 's-tag', 't-tag',
    'div', 'span', 'section', 'article', 'header', 'footer',
    'nav', 'aside', 'main', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'pre', 'details', 'summary',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'abbr', 'cite', 'mark', 'small', 'sub', 'sup',
    'del', 's', 'ins', 'u', 'ruby', 'rt', 'rp',
];

/**
 * Sanitize LLM output text for WeChat delivery.
 * Strips all HTML/custom tags, preserves readable text only.
 * @param {string} text - Raw LLM output (may contain HTML, Markdown, custom tags)
 * @returns {string} - Clean plain text suitable for WeChat
 */
export function sanitizeForWechat(text) {
    if (!text) return '';

    let result = text;

    // 1. Remove tags that should be stripped WITH their content
    for (const tag of [...STRIP_WITH_CONTENT, ...STRIP_CUSTOM_TAGS_WITH_CONTENT]) {
        // Match both <tag>...</tag> and self-closing <tag/>
        const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>|<${tag}[^>]*\\/>`, 'gi');
        result = result.replace(regex, '');
    }

    // 2. Convert formatting tags to text equivalents
    // <b> / <strong> → **text**
    result = result.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**');
    // <i> / <em> → *text*
    result = result.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*');
    // <code> → `text`
    result = result.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    // <br> / <br/> → newline
    result = result.replace(/<br\s*\/?>/gi, '\n');
    // <p>...</p> → text + double newline
    result = result.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
    // <hr> → ---
    result = result.replace(/<hr\s*\/?>/gi, '\n---\n');

    // 3. Strip remaining HTML tags (keep text content)
    // This catches any tags not explicitly handled above
    result = result.replace(/<[^>]+>/g, '');

    // 4. Decode common HTML entities
    result = result
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));

    // 5. Remove Markdown images ![alt](url) — WeChat can't render them
    result = result.replace(/!\[[^\]]*\]\([^)]+\)/g, '');

    // 6. Remove Markdown image reference syntax ![alt][ref]
    result = result.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '');

    // 7. Normalize whitespace
    // Collapse 3+ consecutive newlines into 2
    result = result.replace(/\n{3,}/g, '\n\n');
    // Remove leading/trailing whitespace per line (but keep newlines)
    result = result.split('\n').map(line => line.trim()).join('\n');
    // Trim overall
    result = result.trim();

    return result;
}
