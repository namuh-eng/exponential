type AccountProfileSettings = {
  username: string;
  pronouns: string;
  title: string;
  location: string;
  timezone: string;
  showLocalTime: boolean;
};

const DEFAULT_ACCOUNT_PROFILE_SETTINGS: AccountProfileSettings = {
  username: "",
  pronouns: "",
  title: "",
  location: "",
  timezone: "",
  showLocalTime: false,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeTimezone(value: unknown) {
  const timezone = normalizeText(value, 80);
  if (!timezone) {
    return "";
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return "";
  }
}

export function readAccountProfileFromUserSettings(
  settings: unknown,
): AccountProfileSettings {
  const parsed = asRecord(settings);
  const accountProfile = asRecord(parsed.accountProfile);

  return {
    username:
      normalizeUsername(accountProfile.username) ||
      DEFAULT_ACCOUNT_PROFILE_SETTINGS.username,
    pronouns: normalizeText(accountProfile.pronouns, 80),
    title: normalizeText(accountProfile.title, 120),
    location: normalizeText(accountProfile.location, 120),
    timezone: normalizeTimezone(accountProfile.timezone),
    showLocalTime:
      typeof accountProfile.showLocalTime === "boolean"
        ? accountProfile.showLocalTime
        : DEFAULT_ACCOUNT_PROFILE_SETTINGS.showLocalTime,
  };
}

export function writeAccountProfileToUserSettings(
  settings: unknown,
  accountProfile: AccountProfileSettings,
) {
  const parsed = asRecord(settings);

  return {
    ...parsed,
    accountProfile,
  };
}

export function sanitizeAccountProfileUsername(value: unknown) {
  return normalizeUsername(value);
}

export function sanitizeAccountProfileMetadata(input: {
  pronouns?: unknown;
  title?: unknown;
  location?: unknown;
  timezone?: unknown;
  showLocalTime?: unknown;
}) {
  return {
    pronouns: normalizeText(input.pronouns, 80),
    title: normalizeText(input.title, 120),
    location: normalizeText(input.location, 120),
    timezone: normalizeTimezone(input.timezone),
    showLocalTime:
      typeof input.showLocalTime === "boolean" ? input.showLocalTime : false,
  };
}

export function isValidAccountProfileTimezone(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return true;
  }
  return typeof value === "string" && normalizeTimezone(value) === value.trim();
}
