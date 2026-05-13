const DATABASE_BOOTSTRAP_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "ECONNRESET",
]);

const DATABASE_BOOTSTRAP_MESSAGE_PATTERNS = [
  /connect\s+ECONNREFUSED/i,
  /password authentication failed/i,
  /database .* does not exist/i,
  /role .* does not exist/i,
  /no pg_hba\.conf entry/i,
  /connection terminated unexpectedly/i,
  /remaining connection slots are reserved/i,
];

export function isDatabaseBootstrapError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (
    typeof maybeError.code === "string" &&
    DATABASE_BOOTSTRAP_CODES.has(maybeError.code)
  ) {
    return true;
  }

  if (
    typeof maybeError.message === "string" &&
    DATABASE_BOOTSTRAP_MESSAGE_PATTERNS.some((pattern) =>
      pattern.test(maybeError.message as string),
    )
  ) {
    return true;
  }

  return isDatabaseBootstrapError(maybeError.cause);
}

export function shouldRenderDatabaseBootstrapError(error: unknown) {
  if (!isDatabaseBootstrapError(error)) {
    return false;
  }

  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_TEST === "true"
  );
}

export const DATABASE_BOOTSTRAP_TITLE = "Local database is unavailable";
export const DATABASE_BOOTSTRAP_MESSAGE =
  "Whetline could not connect to Postgres while loading the authenticated app shell. Start the local services, or point DATABASE_URL at an existing host Postgres if Docker is unavailable, apply the schema, then reload.";
