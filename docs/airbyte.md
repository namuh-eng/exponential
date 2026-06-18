# Airbyte source

Exponential exposes a read-only Airbyte source surface for warehouse, lake, and database analytics syncs.

## Generate a token

1. Open `Settings -> API`.
2. In `Airbyte warehouse sync`, choose `Generate Airbyte token`.
3. Copy the `pat_...` bearer token immediately. It is shown once.
4. Revoke old tokens from the same section when rotating credentials.

Only workspace owners and admins can generate or revoke Airbyte tokens. Tokens are personal access tokens scoped exactly to `read`, so existing mutation endpoints reject them.

## Configure Airbyte

Use Airbyte Open Source's HTTP API source or connector builder with:

- Base URL: `https://<your-host>/api/airbyte`
- Auth header: `Authorization: Bearer <pat_token>`
- Check endpoint: `GET /check`
- Discover endpoint: `GET /discover` (same catalog metadata as `GET /catalog`)
- Catalog endpoint: `GET /catalog`
- Stream endpoint: `GET /streams/<stream>?cursor=<iso_timestamp>&limit=100`

The `cursor` parameter is optional for full refresh. For incremental syncs, send the previous response's `next_cursor` value. Responses are ordered by each stream's cursor and then primary key.

## Supported streams

| Stream | Primary key | Incremental cursor | Notes |
| --- | --- | --- | --- |
| `issues` | `id` | `updated_at` | Includes issue metadata, descriptions, assignee, creator, project, cycle, archive, completion, and cancellation timestamps. |
| `projects` | `id` | `updated_at` | Includes project dates, status, priority, lead, and workspace metadata. |
| `comments` | `id` | `updated_at` | Includes issue comments and author ids. |
| `cycles` | `id` | `updated_at` | Includes cycle number, team, date window, and rollover flag. |
| `initiatives` | `id` | `updated_at` | Includes roadmap metadata, owner, health, timeframe, and hierarchy parent. |

All streams support full refresh and incremental sync. Customer/customer request streams are not exposed yet; add them after first-class customer storage and API surfaces land in #556.

## Private data behavior

Airbyte tokens are workspace-scoped read-only integration tokens. They include data from private teams in the workspace, including private-team issues, comments, cycles, initiatives, and project metadata. Generate tokens only for trusted warehouse destinations and revoke tokens that are no longer in use.
