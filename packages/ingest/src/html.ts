import { parseHTML } from 'linkedom';
import sanitizeHtml from 'sanitize-html';

export function normalizeText(input: string): string {
  return input
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'b',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'code',
      'pre',
      'figure',
      'figcaption',
      'img',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        rel: 'noopener noreferrer nofollow',
      }),
      img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
    },
    disallowedTagsMode: 'discard',
  });
}

export function htmlToText(html: string): string {
  if (!html.trim()) {
    return '';
  }

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const element of document.querySelectorAll(
    'script, style, noscript, template, svg, iframe',
  )) {
    element.remove();
  }

  const text = document.body?.textContent ?? document.documentElement.textContent;
  return normalizeText(text ?? '');
}
