import { describe, expect, it } from 'vitest';
import { OpmlError, parseOpml } from './opml';

const opml = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline text="Example" type="rss" xmlUrl="https://example.com/feed?utm_source=x" />
      <outline text="Atom" type="atom" xmlUrl="https://example.com/atom.xml" />
      <outline text="JSON" type="json" xmlUrl="https://example.com/feed.json" />
    </outline>
    <outline text="Italy">
      <outline text="Duplicate" xmlUrl="https://example.com/feed" />
    </outline>
  </body>
</opml>`;

describe('parseOpml', () => {
  it('collects feeds with their nearest category and type', () => {
    expect(parseOpml(opml)).toEqual([
      {
        url: 'https://example.com/feed',
        title: 'Example',
        category: 'Tech',
        sourceType: 'RSS',
      },
      {
        url: 'https://example.com/atom.xml',
        title: 'Atom',
        category: 'Tech',
        sourceType: 'ATOM',
      },
      {
        url: 'https://example.com/feed.json',
        title: 'JSON',
        category: 'Tech',
        sourceType: 'JSON_FEED',
      },
    ]);
  });

  it('skips malformed URLs and falls back to the hostname', () => {
    expect(
      parseOpml(`<opml><body>
        <outline xmlUrl="ftp://example.com/feed" />
        <outline xmlUrl="https://example.com/rss" />
      </body></opml>`),
    ).toEqual([
      {
        url: 'https://example.com/rss',
        title: 'example.com',
        category: null,
        sourceType: 'RSS',
      },
    ]);
  });

  it('rejects documents without a body', () => {
    expect(() => parseOpml('<rss></rss>')).toThrow(OpmlError);
  });

  it('rejects DOCTYPE declarations', () => {
    const xml = `<!DOCTYPE opml [<!ENTITY expanded "payload">]>
      <opml><body><outline text="&expanded;" xmlUrl="https://example.com/feed" /></body></opml>`;
    expect(() => parseOpml(xml)).toThrow(OpmlError);
  });

  it('rejects excessively deep nesting', () => {
    let xml = '<opml><body>';
    for (let depth = 0; depth < 40; depth += 1) {
      xml += '<outline>';
    }
    xml += '<outline xmlUrl="https://example.com/feed" />';
    for (let depth = 0; depth < 41; depth += 1) {
      xml += '</outline>';
    }
    xml += '</body></opml>';
    expect(() => parseOpml(xml)).toThrow(OpmlError);
  });

  it('does not crash on out-of-range numeric entities', () => {
    expect(() =>
      parseOpml(`<opml><body>
        <outline text="&#x110000;" xmlUrl="https://example.com/feed" />
      </body></opml>`),
    ).not.toThrow();
  });
});
