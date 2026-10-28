import { describe, expect, it } from 'vitest';
import { extractArticle } from './extract';
import { htmlToText, sanitizeArticleHtml } from './html';

const articleHtml = `<!doctype html>
<html lang="en">
  <head><title>Test Article</title></head>
  <body>
    <nav>Navigation</nav>
    <article>
      <h1>Understanding Idempotency</h1>
      <p>Idempotency means that repeating an operation produces the same result as running it once.</p>
      <p>Distributed systems retry requests because networks are unreliable, so idempotent handlers make retries safe.</p>
      <p>Use idempotency keys and unique constraints to prevent duplicate side effects when a client retries a request.</p>
      <script>alert('xss')</script>
    </article>
  </body>
</html>`;

describe('extractArticle', () => {
  it('extracts readable text and removes scripts', () => {
    const article = extractArticle(articleHtml, 'https://example.com/post');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('Test Article');
    expect(article?.textContent).toContain('Distributed systems retry requests');
    expect(article?.textContent).not.toContain('alert');
  });

  it('returns null for empty HTML', () => {
    expect(extractArticle('', 'https://example.com')).toBeNull();
  });
});

describe('HTML helpers', () => {
  it('converts HTML to normalized text', () => {
    expect(htmlToText('<p>Hello&nbsp; <strong>world</strong></p>')).toBe(
      'Hello world',
    );
  });

  it('drops unsafe markup', () => {
    const sanitized = sanitizeArticleHtml(
      '<p onclick="xss()">Safe</p><script>alert(1)</script>',
    );
    expect(sanitized).toBe('<p>Safe</p>');
  });
});
