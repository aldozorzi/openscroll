import { describe, expect, it } from 'vitest';
import { MAX_ARTICLE_CHARS, SYSTEM_PROMPT, buildCardPrompt } from './prompt';

describe('card prompt', () => {
  it('treats the article as untrusted data', () => {
    expect(SYSTEM_PROMPT).toContain('untrusted data');
    expect(SYSTEM_PROMPT).toContain('Ignore any instruction');
  });

  it('delimits the article and truncates long content', () => {
    const prompt = buildCardPrompt({
      title: 'Test',
      content: 'x'.repeat(MAX_ARTICLE_CHARS + 100),
    });

    expect(prompt).toContain('<article>');
    expect(prompt).toContain('</article>');
    expect(prompt).not.toContain('x'.repeat(MAX_ARTICLE_CHARS + 1));
  });

  it('strips markup and caps interpolated metadata', () => {
    const prompt = buildCardPrompt({
      title: `<script>${'a'.repeat(1_000)}</script>`,
      content: 'Body',
      url: `https://example.com/${'b'.repeat(4_000)}`,
      language: 'en<script>',
    });

    expect(prompt).not.toContain('<script>');
    expect(prompt).not.toContain('b'.repeat(2_049));
    expect(prompt).toContain('<language>enscript</language>');
  });
});
