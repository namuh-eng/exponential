# Airbyte Source

Exponential exposes a read-only Airbyte source surface for warehouse, lake, and
database analytics syncs.

## Generate a Token

1. Open `Settings -> API`.
2. In `Airbyte warehouse sync`, choose `Generate Airbyte token`.
3. Copy the `lin_airbyte_...` bearer token immediately. It is shown once.
4. Revoke old tokens from the same section when rotating credentials.

Only workspace owners and admins can generate or revoke Airbyte tokens.

## Configure Airbyte

Use the HTTP API source or the connector builder with:

- Base URL: `https://<your-host>/api/airbyte`
- Auth header: `Authorization: Bearer <lin_airbyte_token>`
- Check endpoint: `GET /check`
- Discover endpoint: `GET /discover` (same catalog metadata as `GET /catalog`)
- Catalog endpoint: `GET /catalog`
- Stream endpoint: `GET /streams/<stream>?cursor=<iso_timestamp>&limit=100`

The `cursor` parameter is optional for full refresh. For incremental syncs, send
the last emitted `updatedAt` cursor from the previous response.

## Supported Streams

| Stream | Primary key | Incremental cursor | Notes |
| --- | --- | --- | --- |
| `issues` | `id` | `updatedAt` | Includes issue metadata, descriptions, assignee, creator, project, cycle, archive, completion, and cancellation timestamps. |
| `projects` | `id` | `updatedAt` | Includes project dates, status, priority, lead, and workspace metadata. |
| `comments` | `id` | `updatedAt` | Includes issue comments and author ids. |
| `cycles` | `id` | `updatedAt` | Includes cycle number, team, date window, and rollover flag. |
| `initiatives` | `id` | `updatedAt` | Includes roadmap metadata, owner, health, timeframe, and hierarchy parent. |

All streams support full refresh and incremental sync.

Customer/customer request streams are not exposed yet. They should be added
after first-class customer storage and API surfaces land in #556.

## Private Data Behavior

Airbyte tokens are workspace-scoped read-only integration tokens. They include
data from private teams in the workspace, including private-team issues,
comments, cycles, and project metadata. Generate tokens only for trusted
warehouse destinations and revoke tokens that are no longer in use.
