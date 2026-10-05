/**
 * Escapes special regex characters in user search queries
 * to prevent SyntaxError and ReDoS vulnerabilities.
 */
const escapeRegex = (string) => {
  if (!string || typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = { escapeRegex };
