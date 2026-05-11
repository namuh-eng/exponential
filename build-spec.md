# Build Spec — Linear Clone (whetline)

> **Status**: COMPLETE — all pages inspected, ready for build phase

## Product Overview

Linear is a keyboard-first issue tracking and project management tool for software teams. It emphasizes speed, clean design, and opinionated workflows.

**Core features (must build first):**
1. **Issues** — The atomic unit. Workflow states, priority, estimates, labels, assignees, due dates, relations.
2. **Teams** — Organizational unit with namespaced identifiers (ENG-123) and custom workflows.
3. **Command Palette (Cmd+K)** — Search, navigate, create — all from keyboard.
4. **Projects** — Time-bound deliverables grouping issues across teams, with milestones and progress tracking.
5. **Triage** — Intake queue for incoming issues.

**Secondary features:**
- Cycles (automated sprints), Initiatives (strategic goals), Custom Views, Inbox/Notifications, My Issues, Display Options, Filters

**Key differentiators:** Command palette, keyboard shortcuts everywhere, real-time sync, clean minimal dark-mode-first UI.

## Tech Stack

- **Framework**: Next.js 16 App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI primitives
- **Database**: Drizzle ORM + PostgreSQL (AWS RDS)
- **Cache/Realtime**: Redis (AWS ElastiCache) — real-time sync, pub/sub
- **Storage**: AWS S3 — file attachments, avatars
- **Email**: AWS SES — magic link auth, notifications
- **Auth**: Better Auth (Google OAuth + email magic links)
- **Deployment**: AWS ECS Fargate + ALB

## Site Map

### Overall Layout
- **Sidebar** (244px, left) — persistent navigation with workspace switcher, search, create issue button
- **Content area** (right) — 12px border-radius container, 8px margin from edges
- **Ask Linear** — floating AI chat button (bottom-right)
- **Command palette** — Cmd+K global overlay

### Pages
| Section | Page | URL Pattern | Type |
|---------|------|-------------|------|
| Personal | Inbox | `/inbox` | Notification list |
| Personal | My Issues | `/my-issues/assigned` | Filtered issue list (tabs: Assigned, Created, Subscribed, Activity) |
| Workspace | Projects | `/projects/all` | Project table |
| Workspace | Views | `/views/issues` | View list (tabs: Issues, Projects) |
| Team | Triage | `/team/{key}/triage` | Triage queue |
| Team | Issues | `/team/{key}/all` | Issue list (tabs: All, Active, Backlog + custom) |
| Team | Board | `/team/{key}/board` | Kanban board |
| Team | Projects | `/team/{key}/projects/all` | Team projects |
| Team | Views | `/team/{key}/views/issues` | Team views |
| Team | Cycles | `/team/{key}/cycles` | Cycle list |
| Global | Initiatives | `/initiatives` | Initiative list (tabs: Active, Planned, Completed) |
| Detail | Issue | `/issue/{id}` | Full issue page |
| Detail | Project | `/project/{slug}/overview` | Project detail (tabs: Overview, Activity, Issues) |
| Settings | Account | `/settings/account/*` | 6 pages: Preferences, Profile, Notifications, Security, Connected, Agents |
| Settings | Issues | `/settings/issue-*` | Labels, Templates, SLAs |
| Settings | Projects | `/settings/project-*` | Labels, Templates, Statuses, Updates |
| Settings | Features | `/settings/{feature}` | AI, Initiatives, Documents, Customer requests, Pulse, Asks, Emojis, Integrations |
| Settings | Admin | `/settings/{admin}` | Workspace, Teams, Members, Security, API, Applications, Billing, Import/export |
| Settings | Team | `/settings/teams/{key}/*` | General, Members, Notifications, Labels, Templates, Recurring, Statuses, Workflow, Triage, Cycles, Agents, AI |

## Authentication (P1)

### Methods
1. **Google OAuth** — Better Auth Google provider
2. **Email Magic Links** — Better Auth email + SES, 6-digit code + clickable link
3. No passwords — fully passwordless

### Flow
- Login page: "Continue with Google" + "Continue with Email"
- New users → workspace creation → default team auto-created
- Existing users → redirect to last workspace
- Sessions in Postgres via Better Auth Drizzle adapter
- Protected routes via Next.js middleware

## Onboarding (P2-P3)

1. Sign up (Google or magic link)
2. Create workspace (name + URL slug) — auto-creates default team
3. Invite team members (skippable)
4. Land on dashboard with empty states

## Design System

### Colors
| Token | Dark (default) | Light |
|-------|---------------|-------|
| Sidebar bg | #090909 | #f5f5f5 |
| Content bg | #0f0f11 | #fcfcfd |
| Border | #1c1e21 | #e0e0e0 |
| Text primary | #ffffff | #23252a |
| Text secondary | #6b6f76 | #b0b5c0 |
| Accent | #7180ff | #7180ff |

### Typography
- Font: Inter Variable (preloaded woff2)
- Issue titles: ~14px semibold
- Secondary text: ~12px
- Sidebar items: ~13px

### Layout
- Sidebar: 244px fixed, collapsible
- Content: 12px border-radius, 8px margin
- Board columns: Equal-width, individually scrollable
- Issue rows: ~40px height, compact

### Key Components
- **Priority icons**: Urgent (red !), High (orange ↑), Medium (yellow =), Low (blue ↓), None (gray —)
- **Status indicators**: Circle icons — empty (backlog/triage), half (started), check (done), X (canceled)
- **Labels**: Colored dots with text
- **Avatars**: 20px circular with initials fallback
- **Issue card** (board): title, identifier, priority, labels, assignee, project
- **Issue row** (list): identifier, title, assignee, priority, labels, project, date
- **Modals**: Centered, backdrop, close button

### Issue Creation Modal
- Team selector (ENG), title (contenteditable), description (rich text)
- Bottom toolbar: Status, Priority, Assignee, Project, Labels (combobox dropdowns)
- More actions, file attachment, "Create more" toggle, submit

### Display Options Panel
- Layout: List / Board toggle
- Columns (Status), Rows (grouping), Ordering (Priority)
- Toggles: sub-issues, triage, empty columns, completed recency
- Display properties: ID, Status, Assignee, Priority, Project, Due date, Milestone, Labels, Links, Time in status, Created, Updated, PRs

### Command Palette (Cmd+K)
- Search: "Type a command or search..." — quick results with issue matching
- "Ask Linear" tab for AI
- Grouped commands: Views, Issues, Projects, Documents, Filter, Templates, Navigation
- Keyboard shortcuts shown (C=create, V=fullscreen, N+P=project, N+U=update)
- Bottom: Open (Enter), Advanced search (Cmd+/), More actions, Quick look

## Workflow State Machine

Issues flow through these state categories:

| Category | States | Icon |
|----------|--------|------|
| Triage | Triage | Orange circle |
| Backlog | Backlog (default), Spec Needed, Research Needed | Empty circle |
| Unstarted | Todo | Empty circle |
| Started | Research In Progress, Research in Review, Ready for Plan, Plan in Progress, Plan in Review, Ready for Dev, In Dev, Code Review | Half circle |
| Completed | Done | Green check |
| Canceled | Canceled, Duplicate | Gray X |

Teams can customize statuses within each category. Default for new issues: Backlog.

## Data Models

### Workspace
- id, name, urlSlug, createdAt, updatedAt
- Settings: login methods, security, approved email domains

### Team
- id, name, key (e.g. "ENG"), workspaceId
- Settings: workflow states, labels, estimates, cycles enabled, triage enabled
- Private flag, memberCount

### WorkflowState
- id, name, teamId, category (triage/backlog/unstarted/started/completed/canceled)
- color, description, position (sort order)

### Issue
- id, number (auto-increment per team), identifier (ENG-123)
- title, description (rich text markdown)
- teamId, stateId, assigneeId, creatorId
- priority (0=none, 1=urgent, 2=high, 3=medium, 4=low), estimate
- labelIds[], parentIssueId, projectId, projectMilestoneId, cycleId
- dueDate, sortOrder
- createdAt, updatedAt, archivedAt, canceledAt, completedAt

### IssueRelation
- id, issueId, relatedIssueId, type (blocks/blocked_by/duplicate/related)

### Project
- id, name, description, icon (emoji), status (planned/started/paused/completed/canceled)
- priority (urgent/high/medium/low/none), leadId, memberIds[]
- startDate, targetDate, teamIds[]
- slackChannelId, createdAt, updatedAt

### ProjectMilestone
- id, name, projectId, sortOrder
- Progress: issueCount, completedIssueCount

### Cycle
- id, name, number, teamId
- startDate, endDate, autoRollover
- Progress: issueCount, completedIssueCount

### Initiative
- id, name, description, status (active/planned/completed)
- projectIds[], parentInitiativeId

### Label
- id, name, color, workspaceId (or teamId for team-scoped)

### CustomView
- id, name, ownerId, filterState (JSON), layout (list/board/timeline)
- isPersonal, teamId (optional)

### Comment
- id, body (rich text), issueId, userId, createdAt
- Reactions: [{emoji, userId}]

### Notification
- id, userId, issueId, actorId, type (assigned/mentioned/status_change/comment/duplicate)
- readAt, createdAt

### Member
- id, userId, workspaceId, role (owner/admin/member/guest)

## API Architecture

REST API routes (Next.js App Router API routes):
- `POST /api/auth/*` — Better Auth endpoints
- `GET/POST/PATCH/DELETE /api/workspaces/*`
- `GET/POST/PATCH/DELETE /api/teams/*`
- `GET/POST/PATCH/DELETE /api/issues/*`
- `GET/POST/PATCH/DELETE /api/projects/*`
- `GET/POST/PATCH/DELETE /api/cycles/*`
- `GET/POST/PATCH/DELETE /api/initiatives/*`
- `GET/POST/PATCH/DELETE /api/views/*`
- `GET/POST/PATCH/DELETE /api/labels/*`
- `GET/PATCH /api/notifications/*`
- `POST /api/issues/*/comments`
- `POST /api/issues/*/relations`

## Settings Architecture

### Settings Layout
- Left sidebar navigation with grouped sections (Account, Issues, Projects, Features, Administration, Your teams)
- "Back to app" link at top of sidebar
- Section headers as non-clickable group labels
- Active page highlighted in sidebar
- Content area on right with form fields
- Same dark/light theme as main app

### Account Settings (Personal — per-user)

**Preferences** (`/settings/account/preferences`):
- General: Default home view (combobox — options include Linear Agent, My Issues, etc.), Display names (combobox: Full name/First name), First day of week (combobox: Sunday/Monday), Convert emoticons toggle (checked by default), Send comment shortcut (combobox: ⌘+Enter / Enter)
- Interface & theme: App sidebar "Customize" button (opens sidebar customization), Font size (Default), Use pointer cursors toggle, Interface theme selector with preview cards (System preference / Light / Dark), separate Light theme and Dark theme selectors
- Desktop application: Open in desktop app toggle
- Coding tools: link to sub-page

**Profile** (`/settings/account/profile`):
- Profile picture: circular avatar upload (recommended 256x256px), shows current avatar
- Email: read-only display (from authenticated user session)
- Full name: editable text input
- Username: editable text input ("One word, like a nickname or first name")
- "Update" button to save changes
- Workspace access section: "Leave workspace" button (danger action)

**Notifications** (`/settings/account/notifications`):
- Notification channels as clickable cards linking to sub-pages:
  - Desktop (enabled for assignments, status changes, 10 others)
  - Mobile (enabled for all notifications)
  - Email (disabled)
  - Slack (disabled)
- Updates from Linear: Changelog (show in sidebar toggle, newsletter toggle), Marketing toggle
- Other: Invite accepted, Privacy/legal updates, DPA toggles

**Security & access**: Passkeys, active sessions, API keys
**Connected accounts**: OAuth connections (Google, etc.)
**Agent personalization**: AI agent behavior customization

### Issues Settings (Workspace-level)

**Labels** (`/settings/issue-labels`):
- Table: Name (colored dot + text), Description (inline editable, placeholder "Add label description..."), Rules, Issues count, Last applied date, Created date
- "New group" and "New label" buttons in header
- Workspace-scoped (available to all teams)
- Example labels: agent, browser, bug, extension, frontend, meta, V-2

**Templates** (`/settings/issue-templates`): Pre-filled templates for issues, documents, projects
**SLAs** (`/settings/sla`): Service level agreement configuration

### Projects Settings (Workspace-level)
- **Labels**: Project-scoped labels
- **Templates**: Project templates
- **Statuses**: Project status configuration
- **Updates**: Project update settings

### Features Settings (Workspace-level)
- **AI & Agents**: AI feature configuration
- **Initiatives**: Enable/configure initiatives
- **Documents**: Document settings
- **Customer requests**: Customer request integration
- **Pulse**: Pulse check-in feature
- **Asks**: Ask feature settings
- **Emojis**: Custom emoji management
- **Integrations**: Third-party integrations catalog

### Administration Settings

**Workspace** (`/settings/workspace`):
- Logo upload (256x256 recommended, circular display with initials fallback)
- Name: editable text input
- URL: "linear.app/" + slug (editable)
- Time & region: First month of fiscal year (combobox: January), Region (read-only, set at workspace creation, e.g., "United States")
- Welcome message: Configure button
- Danger zone: "Delete workspace" button (schedules permanent deletion)

**Teams** (`/settings/teams`): Team list management
**Members** (`/settings/members`):
- Table: Name, Email, Status, Teams, Joined, Last seen
- Tabs: "All"
- "Export CSV" and "Invite" buttons
- Shows Active count and Application count separately (e.g., "Active 2", "Application 3")

**Security** (`/settings/security`):
- Workspace access: Invite links toggle with generated URL + Copy, Approved email domains
- Authentication methods: Google toggle, Email & passkey toggle, SAML & SCIM (paid feature link)
- Note: "Admins and guests can always authenticate via Google and email/passkeys — even when disabled for members"
- Workspace management permissions: New user invitations, Team creation, Manage workspace labels, Manage workspace templates, API key creation (Only admins), Modify agent guidance (Only admins) — each as permission level selector
- Restrict file uploads toggle
- AI: Improve AI toggle, Enable web search toggle
- Compliance: HIPAA compliance toggle

**API** (`/settings/api`):
- GraphQL API description with docs link
- OAuth Applications: list + "New OAuth application" button
- Webhooks: list + "New webhook" button (HTTP POST on entity create/update/delete)
- Member API keys: permission setting (Only admins), list showing key name, access level (full access/public teams), creator avatar, created/last used dates

**Applications** (`/settings/applications`): Third-party app management
**Billing** (`/settings/billing`): Out of scope (billing/paywalls excluded)
**Import & export** (`/settings/import-export`): Data import/export tools

### Team Settings (per-team configuration)

**Hub page** (`/settings/teams/{key}`):
- Card-style links to sub-pages with descriptions and counts
- Sections: General, Members, Slack notifications | Issues/projects/docs | Workflow | AI | Team hierarchy | Danger zone

**General** (`/settings/teams/{key}/general`):
- Icon & Name: editable team icon + name
- Identifier: used in issue IDs (e.g., "ENG"), editable
- Timezone: combobox (GMT offset + city, e.g., "GMT-7:00 – Pacific Time - Los Angeles")
- Estimates: Issue estimation toggle (options: Not in use / Linear / Exponential / T-shirt sizing)
- Create issues by email: toggle with team-specific email address
- Enable detailed issue history: toggle for audit-level change tracking

**Members**: Team member management, shows count (e.g., "2 members")
**Slack notifications**: Broadcast to Slack channel (e.g., "#linear")
**Issue Labels**: Team-scoped labels (e.g., "11 labels"), separate from workspace labels
**Templates**: Pre-filled templates for issues/documents/projects
**Recurring Issues**: Scheduled auto-creation of issues

**Issue Statuses** (`/settings/teams/{key}/statuses`):
- Visual list grouped by category with section headers:
  - **Triage**: Triage (68 issues, "Issue needs to be triaged")
  - **Backlog**: Backlog (Default, 6 issues), Spec Needed (1), Research Needed (2)
  - **Unstarted**: Todo
  - **Started**: Research In Progress (1), Research in Review, Ready for Plan, Plan in Progress, Plan in Review (1), Ready for Dev, In Dev, Code Review (3)
  - **Completed**: Done (25 issues, "Task completed")
  - **Canceled**: Canceled, Duplicate (1)
- Each status: name, issue count badge, description text
- "Default" badge on first Backlog status
- Duplicate issue status selector at bottom
- Statuses reorderable and editable within categories, customizable per team

**Workflows & Automations**: Git workflows, auto-assignment, status transition rules
**Triage**: Enable/disable, triage settings (Enabled)
**Cycles**: Focus team over time-boxed windows (Off / configurable)
**Agents**: AI agent guidance per team
**Discussion summaries**: Auto-generate AI summaries

**Team hierarchy**: Parent team selector (sub-teams feature)
**Danger zone**: Leave team, Retire team (preserves data), Delete team (30-day restoration window)

## Build Order

1. **P0 — Infrastructure** (infra-001 to infra-004)
   - Database schema with Drizzle ORM — all tables listed in Data Models
   - Redis connection (ioredis + ElastiCache)
   - S3 storage utilities (presigned URLs)
   - SES email utilities

2. **P1 — Auth** (auth-001 to auth-004)
   - Google OAuth via Better Auth
   - Email magic links via Better Auth + SES
   - Session management + protected routes middleware
   - Login/signup page UI

3. **P2 — Core Layout & Onboarding** (layout-001, layout-002, design-001, onboarding-001)
   - App shell: sidebar + content area, dark/light theme
   - Sidebar navigation with all sections
   - Design system: colors, typography, icons, components
   - Workspace creation flow + default team

4. **P3 — Issues (Core)** (feature-001 to feature-004, feature-040)
   - Issue list view grouped by workflow state
   - Issue board view (kanban columns)
   - Issue detail page (title, description, properties, activity, comments)
   - Create issue modal with all properties
   - Command palette (Cmd+K) with search + commands

5. **P4 — Filters & My Issues** (feature-005, feature-006, feature-021)
   - Display options panel (layout, grouping, ordering, properties)
   - Filter bar (status, priority, assignee, label, project, date)
   - My Issues page (Assigned/Created/Subscribed/Activity tabs)

6. **P5 — Projects & Triage** (feature-010, feature-011, feature-032)
   - Projects list (table with name, health, priority, lead, date, status)
   - Project detail (overview, milestones, progress, activity, issues tabs)
   - Triage queue (incoming issues, accept/decline)

7. **P6 — Views & Inbox** (feature-041, feature-020)
   - Custom views (saved filter configurations)
   - Inbox notifications (notification list, mark read)

8. **P7 — Cycles** (feature-030)
   - Cycle management, auto-start/end, progress tracking

9. **P8 — Initiatives** (feature-031)
   - Initiative management, project grouping, progress at scale

10. **P9 — Settings Core** (settings-001, settings-002, settings-003, settings-007, settings-010, settings-011, settings-012)
    - Settings layout shell (sidebar nav + content area)
    - Account preferences (theme, display names, home view)
    - Account profile (name, avatar, username)
    - Issue labels management (workspace-level)
    - Team settings hub + general + issue statuses

11. **P10 — Settings Secondary** (settings-004, settings-005, settings-006, settings-008, settings-009, onboarding-002, onboarding-003)
    - Account notifications
    - Workspace admin (logo, name, URL, danger zone)
    - Members admin (table, invite, export CSV)
    - Workspace security (auth methods, permissions, invite links)
    - API & webhooks admin
    - Invite team members flow
    - Empty states for all features

12. **Last — Deployment**
    - Docker build, ECR push, ECS Fargate + ALB
