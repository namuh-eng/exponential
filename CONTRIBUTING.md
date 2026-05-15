# Contributing to exponential

Thank you for your interest in contributing! We appreciate all contributions — whether it's bug reports, feature requests, code improvements, or documentation updates.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)

---

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to make this project better.

---

## Getting Started

### 1. Fork the Repository

Click the "Fork" button on [GitHub](https://github.com/namuh-eng/exponential) to create your own copy.

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR_USERNAME/exponential.git
cd exponential

# Optional: track the original repo for updates
git remote add upstream https://github.com/namuh-eng/exponential.git
```

### 3. Install Dependencies

```bash
npm install
npx playwright install chromium
```

### 4. Set Up Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 5. Start Infrastructure

```bash
# Terminal 1: PostgreSQL + Redis
make dev-services

# Terminal 2: Next.js dev server
npm run dev
```

The app is now running at `http://localhost:3000`.

---

## Development Workflow

### Create a Feature Branch

```bash
git checkout -b fix/issue-title
# or for features:
git checkout -b feat/feature-name
```

Branch naming:
- `fix/` — bug fixes
- `feat/` — new features
- `docs/` — documentation
- `refactor/` — code improvements
- `test/` — tests

### Make Changes

1. Write or update tests first (TDD approach)
2. Implement the feature or fix
3. Run checks locally
4. Commit with clear messages

### Run Quality Checks

Before committing, ensure everything passes:

```bash
# Type check + lint
make check

# Unit tests
make test

# E2E tests (requires dev server running)
make test-e2e

# Run all
make all
```

All tests must pass before committing.

---

## Commit Guidelines

Keep commits **small and focused** — one logical change per commit.

### Commit Message Format

```
<type>: <subject>

<body (optional)>
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `test` — test updates
- `refactor` — code improvements
- `docs` — documentation
- `chore` — build, dependencies, CI

**Example:**

```
feat: add burndown chart to cycles page

- Add ChartJS for visualization
- Fetch cycle velocity from API
- Display completed vs planned issues
- Add unit tests with Vitest
```

**Keep commits clean:**

```bash
# Before committing, ensure all checks pass
make check && make test

# Make small, logical commits
git commit -m "feat: add issue priority filter"

# Avoid commits like:
# - "fix stuff" ❌
# - "refactor everything" ❌
# - "multiple unrelated changes" ❌
```

---

## Pull Request Process

### Before Opening a PR

1. **Rebase on main** to ensure your branch is up to date:

```bash
git fetch upstream
git rebase upstream/main
```

2. **Run all checks one more time:**

```bash
make all
```

3. **Test manually** — use the dev server to verify your changes work

### Opening a PR

1. Go to your fork on GitHub
2. Click "New Pull Request"
3. Set base branch to `upstream/main` (or `namuh-eng/main`)
4. Fill in the PR template:

```markdown
## Description
Brief summary of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor

## Testing
How was this tested? Include steps to verify.

## Checklist
- [ ] Code follows style guidelines (ran `make check`)
- [ ] Tests pass (`make test` and `make test-e2e`)
- [ ] Documentation updated (if needed)
- [ ] Commits are clear and focused
```

### Review Process

- Maintainers will review within 3-5 business days
- Feedback comes as comments on the PR
- Update your branch with requested changes
- Force push if needed: `git push -f origin fix/issue-title`

Once approved, we'll merge your PR!

---

## Testing Requirements

**Every feature must have tests.** No exceptions.

### Unit Tests (Vitest)

Test business logic, utilities, and components in isolation:

```bash
npm run test
```

**Location:** `tests/unit/` or `tests/`.

**Example:**

```typescript
// tests/lib/priority.test.ts
import { getPriorityColor } from '@/lib/priority';
import { expect, it } from 'vitest';

it('should return red for urgent priority', () => {
  expect(getPriorityColor('urgent')).toBe('text-red-600');
});
```

### E2E Tests (Playwright)

Test full user workflows against a running dev server:

```bash
# In Terminal 2, start the dev server
npm run dev

# In Terminal 1 (or another), run E2E tests
npm run test:e2e
```

**Location:** `tests/e2e/`.

**Example:**

```typescript
// tests/e2e/issue-create.spec.ts
import { test, expect } from '@playwright/test';

test('should create a new issue', async ({ page }) => {
  await page.goto('http://localhost:3000/team/eng');
  await page.click('button:has-text("New issue")');
  await page.fill('input[placeholder="Issue title"]', 'Fix login bug');
  await page.click('button:has-text("Create")');
  await expect(page.locator('text=Fix login bug')).toBeVisible();
});
```

### Debugging Tests

```bash
# Run tests in debug mode with browser visible
npx playwright test --debug

# Run a single test file
npx playwright test tests/e2e/issue-create.spec.ts

# Run tests with headed mode to see browser
npx playwright test --headed
```

---

## Code Style

### TypeScript

- **Strict mode** — no `any` types
- Use explicit return types on functions
- Prefer interfaces over types for objects

```typescript
// Good
function createIssue(title: string, priority: IssuePriority): Promise<Issue> {
  // ...
}

interface Issue {
  id: string;
  title: string;
  priority: IssuePriority;
}

// Bad
function createIssue(title: any) {
  // ...
}
```

### Components

- Use React 19 functional components with hooks
- Keep components focused and small
- Use Radix UI primitives
- Style with Tailwind CSS

```typescript
// Good
export function IssueCard({ issue }: { issue: Issue }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="font-semibold">{issue.title}</h3>
      <p className="text-sm text-gray-500">{issue.description}</p>
    </div>
  );
}

// Bad
export function IssueCard(props: any) {
  return <div>{props.issue}</div>;
}
```

### Formatting

Biome handles all formatting automatically:

```bash
# Check formatting and linting
npm run lint

# Auto-fix formatting and imports
npm run lint:fix
```

Don't fight the formatter — just run `npm run lint:fix` and commit.

---

## Common Questions

**Q: I found a bug. How do I report it?**

A: Open an issue on [GitHub Issues](https://github.com/namuh-eng/exponential/issues) with:
- Clear title
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if applicable)

**Q: Can I contribute a feature before opening a PR?**

A: Yes! Open an issue first to discuss the feature. This prevents wasted effort if the feature is out of scope.

**Q: My PR has conflicts with main. How do I fix it?**

A:
```bash
git fetch upstream
git rebase upstream/main
# Resolve conflicts in your editor
git add .
git rebase --continue
git push -f origin your-branch
```

**Q: How long until my PR is merged?**

A: We aim to review within 3-5 business days. Complex changes may take longer.

**Q: What if my PR gets rejected?**

A: No worries! We'll explain why and suggest improvements. You're welcome to iterate or try a different approach.

---

## Need Help?

- **Documentation** — See [README.md](README.md)
- **Questions** — Open a [GitHub Discussion](https://github.com/namuh-eng/exponential/discussions)
- **Issues** — Report on [GitHub Issues](https://github.com/namuh-eng/exponential/issues)

Thank you for contributing to exponential!
