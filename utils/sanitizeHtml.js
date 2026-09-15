import sanitizeHtml from 'sanitize-html';

const PRINT_HTML_OPTIONS = {
  allowedTags: [
    'b',
    'i',
    'em',
    'strong',
    'u',
    'br',
    'p',
    'span',
    'div',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'small',
    'sub',
    'sup',
    'a',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    '*': ['style', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
};

/** Sanitize clinic-controlled print HTML (letterhead / footer / signature blocks). */
export function sanitizePrintHtml(input) {
  if (input == null) return '';
  return sanitizeHtml(String(input), PRINT_HTML_OPTIONS);
}

export const PRINT_HTML_FIELDS = ['headerHtml', 'footerHtml', 'leftContentHtml', 'rightContentHtml'];
