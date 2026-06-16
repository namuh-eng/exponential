# Zapier Integration

Exponential exposes a Zapier-facing REST contract under `/api/zapier`.

The Zapier Platform app source lives in `apps/zapier`. It wires Zapier OAuth,
REST-hook subscriptions, polling fallbacks, sample payloads, and action calls to
the endpoints below.

## Authentication

Zapier can authenticate with either:

- OAuth 2.0 authorization code flow:
  - Authorize URL: `/api/oauth/authorize`
  - Token URL: `/api/oauth/token`
  - Supported scopes: `read`, `write`, `issues:read`, `issues:write`, `comments:read`, `comments:write`, `projects:read`, `projects:write`, `webhooks:read`, `webhooks:write`
- API key auth:
  - Header: `Authorization: Bearer <lin_api_...>`

Zapier should call `GET /api/zapier/auth/test` after auth. A successful response includes the user and workspace bound to the token.

## Triggers

Polling URLs use `GET /api/zapier/triggers/:trigger`. Supported trigger keys:

- `new_issue`
- `updated_issue`
- `new_comment`
- `new_project`
- `status_change`

Optional query params:

- `since`: ISO timestamp cursor.
- `limit`: 1 to 100, defaults to 20.

`GET /api/zapier` returns the app manifest with trigger URLs and sample payloads.

## Webhook Subscriptions

Zapier can register a webhook-backed trigger with:

```bash
curl -X POST https://app.example.com/api/zapier/hooks/subscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"new_issue","targetUrl":"https://hooks.zapier.com/hooks/catch/..."}'
```

Zapier can clean up a webhook-backed trigger with:

```bash
curl -X POST https://app.example.com/api/zapier/hooks/unsubscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"id":"<subscription id from subscribe>"}'
```

The response returns a per-hook secret and sample signature headers:

- `x-exponential-webhook-timestamp`
- `x-exponential-webhook-signature`

The signature is `HMAC-SHA256(secret, "<timestamp>.<raw payload>")`.

This branch stores Zapier webhook subscriptions and signing metadata. Issue-backed triggers also store the existing webhook event names used by Exponential delivery: `new_issue` includes `created`, while `updated_issue` and `status_change` include `updated`. Background reliable delivery is expected to use the shared webhook delivery foundation when that worker is present.

## Actions

Actions use `POST /api/zapier/actions/:action`.

Supported action keys:

- `create_issue`: `title`, `teamId` or `teamKey`, optional `description`, `stateId`, `priority`, `assigneeId`, `projectId`, `dueDate`.
- `update_issue`: `issueId`, plus one or more editable issue fields.
- `create_comment`: `issueId`, `body`.
- `create_attachment`: `issueId`, `fileName`, `contentType`, `size`, optional `body`. The response creates the attachment metadata, returns a presigned `uploadUrl`, and includes `uploadMethod: "PUT"` plus the required `Content-Type` upload header. The file must be uploaded to that URL before the returned expiration window closes.
- `create_project`: `name`, optional `slug`, `description`, `status`, `teamId` or `teamKey`.

Failed actions return structured, user-readable errors:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Title is required.",
    "field": "title"
  }
}
```
