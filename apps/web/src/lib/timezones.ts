export interface TimezoneOption {
  label: string;
  offsetLabel: string;
  searchableText: string;
  value: string;
}

const FALLBACK_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Helsinki",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function normalizeOffsetLabel(offsetLabel: string) {
  if (offsetLabel === "GMT") {
    return "GMT+00:00";
  }

  const match = offsetLabel.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return offsetLabel;
  }

  const [, sign, hours, minutes = "00"] = match;
  return `GMT${sign}${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function parseOffsetMinutes(offsetLabel: string) {
  const match = offsetLabel.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -totalMinutes : totalMinutes;
}

function getOffsetLabel(timezone: string, referenceDate: Date) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(referenceDate);
    const offsetPart = parts.find(
      (part) => part.type === "timeZoneName",
    )?.value;

    return normalizeOffsetLabel(offsetPart ?? "GMT+00:00");
  } catch {
    return "GMT+00:00";
  }
}

function formatTimezoneLocation(timezone: string) {
  const parts = timezone.split("/");
  if (parts.length === 1) {
    return parts[0].replace(/_/g, " ");
  }

  return parts.slice(1).join(" / ").replace(/_/g, " ");
}

export function buildTimezoneOptions(referenceDate = new Date()) {
  const supportedTimezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];

  const uniqueTimezones = Array.from(
    new Set([...supportedTimezones, ...FALLBACK_TIMEZONES]),
  );

  return uniqueTimezones
    .map((timezone) => {
      const offsetLabel = getOffsetLabel(timezone, referenceDate);
      const location = formatTimezoneLocation(timezone);
      const label = `${offsetLabel} - ${location}`;

      return {
        label,
        offsetLabel,
        searchableText: `${timezone} ${label} ${location}`.toLowerCase(),
        value: timezone,
      } satisfies TimezoneOption;
    })
    .sort((left, right) => {
      const byOffset =
        parseOffsetMinutes(left.offsetLabel) -
        parseOffsetMinutes(right.offsetLabel);
      if (byOffset !== 0) {
        return byOffset;
      }

      return left.label.localeCompare(right.label, "en");
    });
}
