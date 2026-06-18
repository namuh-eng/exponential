# Zapier Integration

Exponential ships a Zapier Platform app contract in `apps/zapier` for no-code automations against the public API.

## Authentication

Use OAuth2 authorization-code auth for the public Zapier app:

- Authorize URL: `/api/oauth/authorize`
- Token URL: `/api/oauth/token`
- Token type: bearer access token
- Required scopes: `issues:read issues:write comments:write projects:read projects:write attachments:write webhooks:write`

Workspace admins create the Zapier OAuth client from **Settings → API → OAuth applications** and register Zapier's redirect URL. Personal access tokens (`pat_...`) remain supported as a private/testing fallback in the Zapier app by setting `apiKey` auth data, but the public Zapier flow should use OAuth.

OAuth access tokens and PATs are scoped on protected API routes. Missing or insufficient scopes return RFC 7807-style responses with `title`, `status`, and `detail` so Zapier can show user-readable failures.

## Triggers

The Zapier app defines webhook-backed triggers and polling/sample fallbacks:

| Zapier trigger | Exponential webhook event | Polling/sample source |
| --- | --- | --- |
| New Issue | `issue.created` | `GET /api/issues?limit=20` |
| Updated Issue | `issue.updated` | `GET /api/issues?limit=20` |
| Issue Status Changed | `issue.status_changed` | sample payload |
| New Comment | `comment.created` | sample payload |
| New Project | `project.created` | `GET /api/projects` |

Subscriptions call `POST /api/workspaces/current/api` with `action=createWebhook`, Zapier's `targetUrl`, and the mapped event. Unsubscribe calls the same endpoint with `action=deleteWebhook`.

Webhook deliveries use the existing reliable delivery queue. Each delivery is signed with `X-Exponential-Signature` and `X-Hub-Signature-256` as `sha256=<hmac>`. The Zapier app stores the one-time webhook secret returned during subscription and verifies the signature before returning rows.

## Actions

| Zapier action | Public API operation |
| --- | --- |
| Create Issue | `POST /api/issues` |
| Update Issue | `PATCH /api/issues/{id}` |
| Create Comment | `POST /api/issues/{id}/comments` |
| Create Project | `POST /api/projects` |
| Create Attachment Upload | `POST /api/attachments/presigned-upload` |

Issue and project actions accept the same IDs and enum values as the public API. Attachment creation currently returns a presigned upload contract (`uploadUrl`, `headers`, `storageKey`, `expiresIn`, `method`, `contentType`) for Zapier to upload bytes; API-level attachment metadata association to an issue/comment remains the follow-up needed for fully automated attachment linking.

## Local validation

```bash
pnpm --filter @namuh-eng/expn-zapier test
pnpm --filter @namuh-eng/expn-zapier typecheck
```

Run `make check` and `make test` before merging API or contract changes.
