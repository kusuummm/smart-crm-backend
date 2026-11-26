/**
 * HTML Sanitization and Context-Aware Output Encoding Utility
 * Defends against Reflected, Stored, and DOM-based Cross-Site Scripting (XSS).
 */

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

/**
 * Escapes unsafe characters for HTML body context
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str.replace(/[&<>"'`=\/]/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

/**
 * Completely strips HTML tags from untrusted user content
 */
function stripHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof str !== 'string') str = String(str);
  return str.replace(/<[^>]*>?/gm, '').trim();
}

/**
 * Validates and sanitizes URLs to prevent DOM-based XSS (e.g. javascript:, data:, vbscript: links)
 */
function sanitizeUrl(url, { defaultProtocol = 'https://', allowEmpty = false } = {}) {
  if (!url || typeof url !== 'string') {
    return allowEmpty ? '' : '#';
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return allowEmpty ? '' : '#';
  }

  // Strictly reject dangerous executable schemes
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return '#';
  }

  // Allow safe protocols
  if (/^(https?|mailto|tel):/i.test(trimmed)) {
    return encodeURI(trimmed);
  }

  // Prepend default protocol for scheme-relative or relative links
  if (trimmed.startsWith('//')) {
    return encodeURI(`https:${trimmed}`);
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return encodeURI(trimmed);
  }

  return encodeURI(`${defaultProtocol}${trimmed}`);
}

/**
 * Sanitizes rich email HTML by stripping executable scripts, iframes, and event handlers
 */
function sanitizeEmailHtml(html) {
  if (!html || typeof html !== 'string') return '';

  let sanitized = html
    // Strip script blocks and tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Strip iframes, objects, embeds, applets
    .replace(/<(iframe|object|embed|applet|meta|link)\b[^>]*>/gi, '')
    .replace(/<\/(iframe|object|embed|applet|meta|link)>/gi, '')
    // Strip javascript: URLs in attributes
    .replace(/href\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, 'href="#"')
    .replace(/src\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, 'src="#"')
    // Strip inline event handlers (onload, onerror, onclick, onmouseover, etc.)
    .replace(/\s+on[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, '');

  return sanitized;
}

module.exports = {
  escapeHtml,
  stripHtml,
  sanitizeUrl,
  sanitizeEmailHtml,
};
