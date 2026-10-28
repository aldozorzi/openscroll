import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { htmlToText, normalizeText, sanitizeArticleHtml } from './html';

export interface ExtractedArticle {
  title: string;
  byline: string | null;
  siteName: string | null;
  language: string | null;
  excerpt: string | null;
  contentHtml: string;
  textContent: string;
}

export function extractArticle(
  html: string,
  url: string,
): ExtractedArticle | null {
  if (!html.trim()) {
    return null;
  }

  const { document } = parseHTML(html);
  document.documentElement.setAttribute('lang', document.documentElement.getAttribute('lang') ?? '');

  const head = document.head ?? document.createElement('head');
  if (!document.head) {
    document.documentElement.prepend(head);
  }
  const base = document.createElement('base');
  base.setAttribute('href', url);
  head.prepend(base);

  const reader = new Readability(document, { charThreshold: 300 });
  const article = reader.parse();

  if (!article) {
    return null;
  }

  const contentHtml = sanitizeArticleHtml(article.content ?? '');
  const textContent =
    normalizeText(article.textContent ?? '') ||
    htmlToText(article.content ?? '') ||
    normalizeText(htmlToText(html));

  if (!textContent) {
    return null;
  }

  return {
    title: normalizeText(article.title ?? '') || 'Untitled',
    byline: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || null,
    language: document.documentElement.getAttribute('lang')?.trim() || null,
    excerpt: article.excerpt?.trim() || null,
    contentHtml,
    textContent,
  };
}
