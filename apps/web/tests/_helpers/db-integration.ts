// Helper for tests that need a real Postgres connection.
//
// Use `describeDb` in place of `describe` at the top of any test file whose
// `beforeAll` / `afterAll` hooks touch the database (drizzle `db.insert`,
// `db.delete`, etc.). By default these suites are SKIPPED so `make test`
// stays green on a developer laptop with no local DB. Set
// `RUN_DB_TESTS=1` (e.g. `RUN_DB_TESTS=1 make test`) to opt in — typically
// after `make dev-services` has brought Postgres + Redis up.
//
// Why not auto-detect availability? An async probe at module load forces
// every test file to await it; an env-var flip is faster, deterministic,
// and matches the way CI gates integration tiers.
//
// Pattern:
//   import { describeDb } from "./_helpers/db-integration";
//   describeDb("My integration suite", () => { ... });

import { describe } from "vitest";

const dbTestsEnabled = process.env.RUN_DB_TESTS === "1";

// `describe.skip` is a chainable variant of `describe`; we only call it as
// `describeDb(name, fn)` so a structural signature is sufficient (and
// avoids the typeof-describe mismatch on `skipIf`/`runIf`).
export const describeDb: (name: string, fn: () => void) => void = dbTestsEnabled
  ? describe
  : describe.skip;
