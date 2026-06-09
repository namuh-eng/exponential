// Shared Vitest setup — loaded for every test file via vitest.config.ts.
//
// Why this file exists:
//   1. `@testing-library/jest-dom/vitest` adds DOM matchers (`toBeInTheDocument`,
//      `toHaveAttribute`, etc.). Without it, tests using those matchers crash
//      with `Invalid Chai property`. Centralizing the import here means every
//      test gets the matchers without an explicit import.
//   2. Vitest 4's jsdom environment ships `window.localStorage` as an object
//      without working methods (`setItem`/`getItem`/`clear` are undefined),
//      which breaks any component that touches localStorage on mount. The
//      polyfill below restores a working in-memory Storage.
//   3. `sessionStorage` is polyfilled for the same reason.
//
// Add cross-cutting test setup here, not in individual test files.

import "@testing-library/jest-dom/vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function ensureStorage(
  target: Window & typeof globalThis,
  name: "localStorage" | "sessionStorage",
) {
  const existing = target[name] as Storage | undefined;
  if (
    existing &&
    typeof existing.setItem === "function" &&
    typeof existing.getItem === "function" &&
    typeof existing.clear === "function"
  ) {
    return;
  }
  Object.defineProperty(target, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

if (typeof window !== "undefined") {
  ensureStorage(window as Window & typeof globalThis, "localStorage");
  ensureStorage(window as Window & typeof globalThis, "sessionStorage");
}
