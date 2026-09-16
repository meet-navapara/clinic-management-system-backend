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
    'font',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    font: ['face', 'size', 'color', 'style'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style', 'class'],
    '*': ['style', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'data'],
  allowProtocolRelative: false,
};

/** Sanitize clinic-controlled print HTML (letterhead / footer / signature blocks). */
export function sanitizePrintHtml(input) {
  if (input == null) return '';
  return sanitizeHtml(String(input), PRINT_HTML_OPTIONS);
}

export const PRINT_HTML_FIELDS = ['headerHtml', 'footerHtml', 'leftContentHtml', 'rightContentHtml'];
