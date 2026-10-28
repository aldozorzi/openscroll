# Copyright and content policy

OpenScroll stores short summaries, hooks, key takeaways, and attribution links,
not full article text indefinitely. Raw content is retained for 7 days and
cleaned content for 30 days by default, then removed by the retention job.

## Attribution

Every card keeps its source title, canonical URL, and author when available. The
card UI links to the original source. Do not remove attribution when forking or
redistributing the application.

## Feed terms, robots, and paywalls

- Only ingest feeds the operator is permitted to use.
- Honor feed terms of service and robots directives.
- Do not bypass paywalls, authentication, or technical access controls.
- Respect rate limits and conditional GET headers.
- Remove a source when its publisher asks.

## Takedown path

Rights holders should contact the operator using the address published on the
instance. Operators should:

1. Sign in to `/admin` with an account whose role is `admin`.
2. Enter the `ADMIN_TOKEN`.
3. Use **Content takedown** with the article UUID and an optional reason.
4. Confirm the cards are hidden and the article content has been cleared.
5. Record the request and outcome in the operator's own incident log.

The API equivalent is:

```http
POST /api/v1/admin/takedown
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{"article_id":"<uuid>","reason":"Rights-holder request"}
```

The endpoint returns `{"removed":true,...}`, hides all cards for the article,
clears `raw_content` and `cleaned_content`, marks the article `skipped`, and
writes an audit-log entry. It is safe to call again.

## Operator responsibilities

- Publish a takedown contact address.
- Respond to valid requests promptly.
- Keep an audit record of removals.
- Do not re-ingest removed content automatically.
- Verify the deployed source link satisfies AGPL section 13.
