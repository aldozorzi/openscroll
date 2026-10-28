import { describe, expect, it } from 'vitest';
import { extractFeedLinks } from './discovery';

describe('extractFeedLinks', () => {
  it('finds RSS, Atom, and JSON feed links and resolves relative URLs', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate stylesheet" type="application/atom+xml" href="atom.xml">
        <link rel="stylesheet" type="text/css" href="/style.css">
      </head></html>`;

    expect(extractFeedLinks(html, 'https://example.com/blog/')).toEqual([
      'https://example.com/feed.xml',
      'https://example.com/blog/atom.xml',
    ]);
  });

  it('ignores feed links without alternate rel', () => {
    const html =
      '<link rel="preload" type="application/rss+xml" href="/feed.xml">';
    expect(extractFeedLinks(html, 'https://example.com/')).toEqual([]);
  });

  it('caps the number of collected links', () => {
    const links = Array.from(
      { length: 200 },
      (_, index) =>
        `<link rel="alternate" type="application/rss+xml" href="/feed-${index}.xml">`,
    ).join('');
    expect(extractFeedLinks(links, 'https://example.com/')).toHaveLength(50);
  });
});
