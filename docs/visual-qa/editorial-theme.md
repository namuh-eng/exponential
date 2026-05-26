# Editorial theme visual QA checklist

Issue: #371. Parent rollout: #366. This checklist accepts the Editorial theme work merged to `staging` and should be attached to implementation PRs that touch themed surfaces.

Design references:

- `/home/jaeyunha/dev/namuh/opengithub/design/project/Prototype.html`
- `/home/jaeyunha/dev/namuh/opengithub/design/project/og.css`
- `/home/jaeyunha/dev/namuh/opengithub/design/project/opengithub Prototype.html`

## How to capture evidence

1. Run Ever CLI first when the browser bridge is available:
   - `ever snapshot`
   - Navigate each surface below, then capture focused screenshots or snapshots that show the changed region.
2. If Ever CLI is blocked, record the exact blocker in the PR and use focused Playwright fallback:
   - `PLAYWRIGHT_BASE_URL=http://localhost:7015 npx playwright test tests/e2e/editorial-theme.spec.ts --project=chromium`
   - Or let Playwright start the app on an alternate port: `PLAYWRIGHT_PORT=7015 npx playwright test tests/e2e/editorial-theme.spec.ts --project=chromium`
3. Attach before/after evidence for the surfaces affected by the PR. Keep screenshots focused enough to inspect spacing, typography, borders, elevation, hover/active state, and empty/error copy.

## Acceptance checklist

- [ ] App shell: sidebar, workspace switcher, top search/command entry, active navigation, hover states, and page background use Editorial tokens.
- [ ] Issue list/detail: rows, status/priority/label chips, issue title typography, detail metadata, comments, and empty states match the Editorial palette and spacing.
- [ ] Project pages: project list, overview cards, updates composer, project tabs, and empty project states use tokenized surfaces and borders.
- [ ] Team pages: team issue list, board columns/cards, cycles, triage, analytics/insights, and team project pages avoid legacy hardcoded colors.
- [ ] Settings: account/workspace settings navigation, forms, inputs, toggles, save buttons, validation/error states, and destructive states are themed.
- [ ] Command palette/dialogs: palette surface, search input, result rows, keyboard hints, create issue/project dialogs, confirmation dialogs, and modal overlays inherit Editorial surfaces.
- [ ] Forms/chips/common primitives: buttons, inputs, textareas, selects, tabs, pills, badges, labels, avatars, cards, tooltips/popovers, focus rings, disabled states, and loading skeletons use design tokens rather than raw color literals.
- [ ] Empty/error states: no data pages, not-found/permission errors, failed API states, and inline validation use tokenized ink, surface, border, accent, warning, and error variables.
- [ ] Dark mode: if enabled for the checked route, repeat the affected captures and verify the `.dark` Editorial aliases, contrast, and focus states.
- [ ] Regression guard: new UI does not bypass `src/app/editorial-theme.css`, `src/lib/editorial-theme-tokens.ts`, or the aliased `--color-*` tokens with one-off hardcoded `#fff`, `#000`, gray ramps, or unreviewed inline styles.

## Automated smoke coverage

`tests/e2e/editorial-theme.spec.ts` visits representative app shell, issue, project, team, settings, command palette, and creation dialog surfaces. It verifies the product shell marker, token aliases, display font fallback, absence of obvious hardcoded inline black/white regressions, and writes Playwright screenshot artifacts under `test-results/`.

Run this before merging any Editorial theme follow-up, and include the command plus artifact paths in the PR evidence section.
