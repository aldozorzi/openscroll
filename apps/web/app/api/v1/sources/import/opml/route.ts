import { sourceSingletonKey } from '@openscroll/queue';
import { requireAuth } from '../../../../../../lib/auth';
import { getDb } from '../../../../../../lib/db';
import {
  handleRoute,
  HttpError,
  json,
  readBodyBytes,
  readTextBody,
} from '../../../../../../lib/http';
import { enqueueSafely } from '../../../../../../lib/queue';
import {
  parseOpmlFeeds,
  OpmlError,
  OPML_MAX_BYTES,
} from '../../../../../../lib/opml';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';
import {
  serializeSource,
  subscribeToSource,
  upsertSource,
} from '../../../../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readOpml(request: Request): Promise<string> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return readTextBody(request, OPML_MAX_BYTES);
  }

  const bytes = await readBodyBytes(request, OPML_MAX_BYTES * 2);
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid multipart form data');
  }

  const value = form.get('file') ?? [...form.values()][0];
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > OPML_MAX_BYTES) {
      throw new HttpError(413, 'BAD_REQUEST', 'OPML file exceeds the 1 MB limit');
    }
    return value;
  }
  if (!value) {
    throw new HttpError(400, 'BAD_REQUEST', 'OPML file is required');
  }
  if (value.size > OPML_MAX_BYTES) {
    throw new HttpError(413, 'BAD_REQUEST', 'OPML file exceeds the 1 MB limit');
  }
  return value.text();
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`opml-import:${session.user.id}`, 5, 60_000);

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > OPML_MAX_BYTES * 2) {
      throw new HttpError(413, 'BAD_REQUEST', 'OPML file exceeds the 1 MB limit');
    }

    const body = await readOpml(request);
    if (Buffer.byteLength(body, 'utf8') > OPML_MAX_BYTES) {
      throw new HttpError(413, 'BAD_REQUEST', 'OPML file exceeds the 1 MB limit');
    }

    let feeds;
    try {
      feeds = parseOpmlFeeds(body);
    } catch (error) {
      if (error instanceof OpmlError) {
        throw new HttpError(400, 'BAD_REQUEST', error.message);
      }
      throw error;
    }

    if (feeds.length === 0) {
      throw new HttpError(400, 'BAD_REQUEST', 'No subscriptions found in OPML');
    }

    const imported = [];
    for (const feed of feeds) {
      // Private sources are scoped per owner, so importing a URL that another
      // user already added creates this user's own independent row.
      const source = await upsertSource(db, {
        url: feed.url,
        title: feed.title,
        sourceType: 'RSS',
        ownerId: session.user.id,
        isPublic: false,
      });
      await subscribeToSource(db, session.user.id, source.id);
      await enqueueSafely(
        'ingest-source',
        { sourceId: source.id },
        { singletonKey: sourceSingletonKey(source.id) },
      );
      imported.push(serializeSource(source, true));
    }

    return json(
      {
        imported: imported.length,
        sources: imported,
        status: 'queued',
      },
      202,
    );
  });
}
