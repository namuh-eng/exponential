# Integration Parity Roadmap

**Owner:** jaeyunha  
**Roadmap parent:** [#592](https://github.com/namuh-eng/exponential/issues/592)  
**Last reviewed:** 2026-06-16

This artifact is the repo-owned backlog contract for Linear-style integration
parity. It intentionally does not introduce integration endpoints, migrations,
SDK changes, or product behavior. Provider runtime work stays in the linked
child issues.

## State legend

| State | Meaning |
| --- | --- |
| Shipped | Closed/completed or labeled shipped; keep listed for dependency context. |
| Blocked | Spec exists, but a dependency must land before pickup. |
| Spec-ready | Implementation contract is clear enough for an owner lane. |
| Spec-needed | Parent or placeholder exists, but it needs provider-specific refinement before pickup. |
| Out of scope | Explicitly excluded from this parity roadmap. |

## P0 build order

1. **Shared integration platform** — ship lifecycle, credential, job, event,
   permission, and admin-health substrate first: [#568](https://github.com/namuh-eng/exponential/issues/568).
2. **Provider install/runtime foundations** — install and verify inbound events
   before automation: GitHub App install [#569](https://github.com/namuh-eng/exponential/issues/569) and Slack runtime [#572](https://github.com/namuh-eng/exponential/issues/572).
3. **Provider automation** — consume the established runtime only: GitHub
   PR/commit automation [#570](https://github.com/namuh-eng/exponential/issues/570), Slack issue/Ask creation [#573](https://github.com/namuh-eng/exponential/issues/573), and outbound webhooks [#562](https://github.com/namuh-eng/exponential/issues/562).
4. **P1+ provider parity** — GitHub Issues, guided imports, support providers,
   GitLab, and customer-request workflows only after P0 foundations are stable.

GitHub install remains tracked separately from this roadmap parent: [#569](https://github.com/namuh-eng/exponential/issues/569)
is the pickup gate for GitHub automation, and [#570](https://github.com/namuh-eng/exponential/issues/570) / [#571](https://github.com/namuh-eng/exponential/issues/571)
stay blocked until an active GitHub App installation and repository mapping are
available.

## P0 — build first

| Order | Category | Build issue | Current state | Blocking dependency / pickup note |
| --- | --- | --- | --- | --- |
| 1 | Shared integration platform: lifecycle, secrets, jobs, admin health | [#568](https://github.com/namuh-eng/exponential/issues/568) | Shipped | Foundation for every provider issue. |
| 2 | GitHub App install, organization/repository mapping, webhook receiver | [#569](https://github.com/namuh-eng/exponential/issues/569) | Spec-ready | Requires #568 substrate; must land before #570 and #571. |
| 3 | GitHub PR/commit linking, magic words, workflow automation | [#570](https://github.com/namuh-eng/exponential/issues/570) | Blocked | Blocked by #569 active installation, repository mapping, and signed webhook ingestion. |
| 4 | Slack OAuth callback, bot token storage, signed event receiver, delivery worker | [#572](https://github.com/namuh-eng/exponential/issues/572) | Shipped | Runtime foundation for Slack automation. |
| 5 | Slack issue creation and Asks intake | [#573](https://github.com/namuh-eng/exponential/issues/573) | Shipped | Consumes #572 runtime. |
| 6 | Reliable outbound webhooks and event coverage | [#562](https://github.com/namuh-eng/exponential/issues/562) | Shipped | Foundation for ecosystem triggers, especially Zapier. |

P0 parent trackers stay broad for planning only:

- Slack parent [#557](https://github.com/namuh-eng/exponential/issues/557):
  spec-needed parent; implementation belongs in [#572](https://github.com/namuh-eng/exponential/issues/572),
  [#573](https://github.com/namuh-eng/exponential/issues/573), and [#574](https://github.com/namuh-eng/exponential/issues/574).
- GitHub parent [#558](https://github.com/namuh-eng/exponential/issues/558):
  spec-needed parent; implementation belongs in [#569](https://github.com/namuh-eng/exponential/issues/569),
  [#570](https://github.com/namuh-eng/exponential/issues/570), and [#571](https://github.com/namuh-eng/exponential/issues/571).

## P1 — core product parity

| Category | Build issue | Current state | Blocking dependency / pickup note |
| --- | --- | --- | --- |
| GitHub Issues two-way sync | [#571](https://github.com/namuh-eng/exponential/issues/571) | Blocked | Requires #569 install/runtime; should follow #570 linkage primitives. |
| Guided GitHub/Jira import/export | [#559](https://github.com/namuh-eng/exponential/issues/559) | Spec-needed | Refine import UX, provider auth, mapping, dry-run, and rollback plan before pickup. |
| Jira sync and guided importer | [#580](https://github.com/namuh-eng/exponential/issues/580) | Spec-ready | Depends on shared integration lifecycle and import substrate from #559 where reused. |
| GitLab merge request linking and workflow automation | [#581](https://github.com/namuh-eng/exponential/issues/581) | Shipped | Keep as a reference implementation for MR event handling. |
| Customer Requests base model | [#556](https://github.com/namuh-eng/exponential/issues/556) | Spec-needed | Required before support-provider request objects can be first-class. |
| Zendesk ticket create/link and closure sync | [#575](https://github.com/namuh-eng/exponential/issues/575) | Spec-ready | Should build on #556 customer-request model and #568 lifecycle. |
| Intercom conversation create/link and customer requests | [#576](https://github.com/namuh-eng/exponential/issues/576) | Spec-ready | Should build on #556 customer-request model and #568 lifecycle. |
| Front conversation create/link and reopen behavior | [#577](https://github.com/namuh-eng/exponential/issues/577) | Spec-ready | Should build on #556 customer-request model and #568 lifecycle. |
| Slack synced threads, rich unfurls, personal/project/team notifications | [#574](https://github.com/namuh-eng/exponential/issues/574) | Shipped | Follow-on Slack parity after #572 and #573. |
| Local MCP write-tool expansion | [#640](https://github.com/namuh-eng/exponential/issues/640) | Shipped | Not a Linear remote MCP substitute; related to #590. |

## P2 — high-value ecosystem parity

| Category | Build issue | Current state | Blocking dependency / pickup note |
| --- | --- | --- | --- |
| Sentry linked issues, source attachments, auto-resolve automation | [#582](https://github.com/namuh-eng/exponential/issues/582) | Shipped | Keep as a reference for external issue-action provider flows. |
| Figma design previews and create/link issues | [#583](https://github.com/namuh-eng/exponential/issues/583) | Spec-ready | Needs OAuth/webhook/preview authorization details in implementation. |
| Microsoft Teams conversational issue/project/document actions | [#584](https://github.com/namuh-eng/exponential/issues/584) | Shipped | Chat provider reference alongside Discord and Slack. |
| Discord slash commands and message linking | [#585](https://github.com/namuh-eng/exponential/issues/585) | Shipped | Chat provider reference alongside Teams and Slack. |
| Notion rich previews | [#586](https://github.com/namuh-eng/exponential/issues/586) | Spec-needed | Needs private-team preview authorization and Notion OAuth details before pickup. |
| Zapier public app with triggers/actions | [#589](https://github.com/namuh-eng/exponential/issues/589) | Spec-ready | Depends on stable public API scopes and #562 webhook delivery. |
| Remote MCP server | [#590](https://github.com/namuh-eng/exponential/issues/590) | Spec-ready | Separate from local stdio MCP; requires authenticated remote transport. |
| AI Agent external surfaces | [#591](https://github.com/namuh-eng/exponential/issues/591) | Spec-ready | Depends on provider identity mapping and review gates across Slack/Teams/support providers. |
| Salesforce case links and realtime status | [#578](https://github.com/namuh-eng/exponential/issues/578) | Spec-ready | Should follow customer-request/support-provider model where possible. |
| Workspace-aware Agent execution foundation | [#555](https://github.com/namuh-eng/exponential/issues/555) | Spec-needed | Parent foundation for #591 external agent surfaces. |

## P3 — analytics and expansion

| Category | Build issue | Current state | Blocking dependency / pickup note |
| --- | --- | --- | --- |
| Google Sheets scheduled export sync | [#587](https://github.com/namuh-eng/exponential/issues/587) | Spec-ready | Requires export schema and private-team data policy. |
| Airbyte read-only source connector | [#588](https://github.com/namuh-eng/exponential/issues/588) | Spec-ready | Requires stable incremental cursors and read-only token/scopes. |
| Gong customer calls to customer requests and issue context | [#579](https://github.com/namuh-eng/exponential/issues/579) | Spec-ready | Should follow #556 customer-request model. |
| Additional third-party directory work | #592 follow-up decision | Out of scope | Do not use #592 as an implementation bucket; create named provider issues when demand is explicit. |

## Related but not workspace integration parity

| Category | Issue | Current state | Boundary |
| --- | --- | --- | --- |
| GitHub login provider | [#515](https://github.com/namuh-eng/exponential/issues/515) | Spec-needed | Authentication provider only; not GitHub App install, repository mapping, or PR/issue automation. |

## Provider issue contract

Every provider implementation issue should stay small enough for one owner lane
and must define the following before pickup:

- **Setup:** OAuth/App install/API-token flow, required environment variables,
  setup-required state, reconnect, and disconnect behavior.
- **Data model:** shared lifecycle fields, provider metadata, external IDs,
  source links, idempotency keys, credential references, and historical-link
  preservation.
- **Webhook/OAuth/sync:** signed inbound events, OAuth callbacks, backfill/sync
  jobs, outbound delivery, retry/dead-letter behavior, and replay handling.
- **Permissions:** workspace/team/member role boundaries, private-team behavior,
  external actor identity mapping, and token/scope requirements.
- **Admin UX:** connected/setup-required/degraded/revoked states, selected org or
  resource summary, last event/success/failure, actionable errors, and safe
  disconnect/reconnect actions.
- **Acceptance criteria:** user-visible behavior, idempotency, no secret leakage,
  inactive/unmapped provider behavior, and compatibility with existing workflows.
- **Validation plan:** `make check`, `make test`, provider fixture tests, OpenAPI
  and SDK regeneration checks when contracts change, and focused UI/Playwright
  coverage for settings or visible provider surfaces.

## Explicit out-of-scope decisions

- #592 is not a provider implementation bucket. It must not add Go API routes,
  migrations, generated SDK changes, or web runtime behavior by itself.
- Billing, paywalls, metering, marketplace monetization, and subscription
  management stay out of scope for this repository.
- Anonymous third-party directory expansion is out of scope until a named
  provider has a scoped issue with setup, data model, auth/sync, permissions,
  admin UX, acceptance criteria, and validation plan.
