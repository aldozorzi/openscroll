import { describe, expect, it } from 'vitest';
import { fetchFeed, FeedParseError, parseFeed } from './feed';

const rss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com/</link>
    <language>en</language>
    <item>
      <title>First Post</title>
      <link>https://example.com/first?utm_source=rss&amp;id=1</link>
      <guid>post-1</guid>
      <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
      <description>Hello &amp; welcome</description>
    </item>
  </channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link href="https://example.org/"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://example.org/entry"/>
    <id>tag:example.org,2026:1</id>
    <updated>2026-10-21T12:00:00Z</updated>
    <summary>Atom summary</summary>
  </entry>
</feed>`;

const jsonFeed = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Feed',
  home_page_url: 'https://json.example/',
  language: 'en',
  items: [
    {
      id: '1',
      url: 'https://json.example/post',
      title: 'JSON Post',
      content_text: 'Plain JSON content',
      date_published: '2026-10-22T08:00:00Z',
      authors: [{ name: 'Ada' }],
    },
  ],
});

describe('parseFeed', () => {
  it('parses RSS and canonicalizes item URLs', async () => {
    const feed = await parseFeed(rss, 'https://example.com/feed.xml');
    expect(feed.title).toBe('Example Feed');
    expect(feed.language).toBe('en');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      externalId: 'post-1',
      url: 'https://example.com/first?id=1',
      title: 'First Post',
      publishedAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('parses Atom', async () => {
    const feed = await parseFeed(atom, 'https://example.org/feed.xml');
    expect(feed.title).toBe('Atom Feed');
    expect(feed.items[0]?.title).toBe('Atom Entry');
    expect(feed.items[0]?.url).toBe('https://example.org/entry');
  });

  it('parses JSON Feed', async () => {
    const feed = await parseFeed(
      jsonFeed,
      'https://json.example/feed.json',
      'application/feed+json',
    );
    expect(feed.items[0]).toMatchObject({
      title: 'JSON Post',
      contentText: 'Plain JSON content',
      author: 'Ada',
      publishedAt: '2026-10-22T08:00:00.000Z',
    });
  });

  it('rejects JSON feeds with a non-array items field', async () => {
    await expect(
      parseFeed(
        JSON.stringify({ title: 'Broken', items: 'not-an-array' }),
        'https://json.example/feed.json',
        'application/feed+json',
      ),
    ).rejects.toBeInstanceOf(FeedParseError);

    await expect(
      parseFeed('[]', 'https://json.example/feed.json', 'application/feed+json'),
    ).rejects.toBeInstanceOf(FeedParseError);
  });

  it('skips malformed JSON items and caps metadata fields', async () => {
    const feed = await parseFeed(
      JSON.stringify({
        title: 't'.repeat(1_000),
        language: 'en-US-extra-long-language',
        items: [
          null,
          'not-an-object',
          { url: 42, title: 'missing url' },
          {
            url: 'https://json.example/a',
            title: 123,
            content_text: { invalid: true },
            authors: 'not-an-array',
          },
          {
            url: 'https://json.example/b',
            title: 'Valid',
            content_text: 99,
            authors: [{ name: 'x'.repeat(400) }],
          },
        ],
      }),
      'https://json.example/feed.json',
      'application/feed+json',
    );

    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      title: 'Untitled',
      contentText: '',
      author: null,
    });
    expect(feed.items[1]?.author).toHaveLength(255);
    expect(feed.title).toHaveLength(512);
    expect(feed.language).toHaveLength(16);
  });
});

describe('fetchFeed', () => {
  it('handles conditional GET 304 responses', async () => {
    const result = await fetchFeed('https://example.com/feed.xml', {
      etag: '"abc"',
      fetchImpl: async () => new Response(null, { status: 304 }),
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    expect(result.notModified).toBe(true);
    expect(result.feed).toBeNull();
  });

  it('returns normalized feed metadata', async () => {
    const result = await fetchFeed('https://example.com/feed.xml', {
      fetchImpl: async () =>
        new Response(rss, {
          headers: {
            'content-type': 'application/rss+xml; charset=utf-8',
            etag: '"v1"',
          },
        }),
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    expect(result.notModified).toBe(false);
    expect(result.etag).toBe('"v1"');
    expect(result.feed?.items[0]?.title).toBe('First Post');
  });
});
