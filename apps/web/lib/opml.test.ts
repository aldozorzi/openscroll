import { describe, expect, it } from 'vitest';
import { parseOpmlFeeds, OpmlError } from './opml';

describe('OPML import', () => {
  it('collects nested feed outlines, deduplicates, and normalizes URLs', () => {
    const feeds = parseOpmlFeeds(`<?xml version="1.0"?>
      <opml version="2.0">
        <body>
          <outline text="Tech">
            <outline text="Example" type="rss" xmlUrl="https://example.com/feed?utm_source=x" />
            <outline text="Atom" type="rss" xmlUrl="https://example.com/atom.xml" />
          </outline>
          <outline text="Duplicate" xmlUrl="https://example.com/feed" />
        </body>
      </opml>`);

    expect(feeds).toEqual([
      { url: 'https://example.com/feed', title: 'Example' },
      { url: 'https://example.com/atom.xml', title: 'Atom' },
    ]);
  });

  it('skips malformed URLs and falls back to the hostname', () => {
    const feeds = parseOpmlFeeds(`<opml><body>
      <outline xmlUrl="ftp://example.com/feed" />
      <outline xmlUrl="https://example.com/rss" />
    </body></opml>`);
    expect(feeds).toEqual([{ url: 'https://example.com/rss', title: 'example.com' }]);
  });

  it('rejects documents without an OPML root', () => {
    expect(() => parseOpmlFeeds('<rss></rss>')).toThrow(OpmlError);
  });

  it('rejects DOCTYPE declarations to block entity expansion', () => {
    const xml = `<!DOCTYPE opml [<!ENTITY expanded "payload">]>
      <opml><body><outline text="&expanded;" xmlUrl="https://example.com/feed" /></body></opml>`;
    expect(() => parseOpmlFeeds(xml)).toThrow(OpmlError);
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
    expect(() => parseOpmlFeeds(xml)).toThrow(OpmlError);
  });
});
