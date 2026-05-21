export type AsksSettings = {
  enabled: boolean;
  intakeEmail: string;
  defaultPriority: "low" | "medium" | "high" | "urgent";
  autoAssign: boolean;
};

export type PulseSettings = {
  enabled: boolean;
  digestFrequency: "daily" | "weekly" | "off";
  burnoutAlerts: boolean;
  velocityTarget: number;
};

export type CustomerRequestsSettings = {
  enabled: boolean;
  intakeEmail: string;
  defaultTeamKey: string;
  linkMode: "manual" | "suggested" | "automatic";
  autoCreateIssues: boolean;
};

export type CollaborationSettings = {
  asks: AsksSettings;
  pulse: PulseSettings;
  customerRequests: CustomerRequestsSettings;
};

const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const DIGEST_FREQUENCIES = new Set(["daily", "weekly", "off"]);
const CUSTOMER_REQUEST_LINK_MODES = new Set([
  "manual",
  "suggested",
  "automatic",
]);

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function sanitizeTeamKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}

export function readCollaborationSettings(
  settings: unknown,
): CollaborationSettings {
  const root = asRecord(settings);
  const collaboration = asRecord(root.collaboration);
  const asks = asRecord(collaboration.asks);
  const pulse = asRecord(collaboration.pulse);
  const customerRequests = asRecord(collaboration.customerRequests);

  return {
    asks: {
      enabled: readBoolean(asks.enabled, false),
      intakeEmail: typeof asks.intakeEmail === "string" ? asks.intakeEmail : "",
      defaultPriority:
        typeof asks.defaultPriority === "string" &&
        PRIORITIES.has(asks.defaultPriority)
          ? (asks.defaultPriority as AsksSettings["defaultPriority"])
          : "medium",
      autoAssign: readBoolean(asks.autoAssign, true),
    },
    pulse: {
      enabled: readBoolean(pulse.enabled, true),
      digestFrequency:
        typeof pulse.digestFrequency === "string" &&
        DIGEST_FREQUENCIES.has(pulse.digestFrequency)
          ? (pulse.digestFrequency as PulseSettings["digestFrequency"])
          : "weekly",
      burnoutAlerts: readBoolean(pulse.burnoutAlerts, true),
      velocityTarget: readPositiveInteger(pulse.velocityTarget, 40),
    },
    customerRequests: {
      enabled: readBoolean(customerRequests.enabled, false),
      intakeEmail:
        typeof customerRequests.intakeEmail === "string"
          ? customerRequests.intakeEmail
          : "",
      defaultTeamKey:
        typeof customerRequests.defaultTeamKey === "string"
          ? sanitizeTeamKey(customerRequests.defaultTeamKey)
          : "",
      linkMode:
        typeof customerRequests.linkMode === "string" &&
        CUSTOMER_REQUEST_LINK_MODES.has(customerRequests.linkMode)
          ? (customerRequests.linkMode as CustomerRequestsSettings["linkMode"])
          : "suggested",
      autoCreateIssues: readBoolean(customerRequests.autoCreateIssues, true),
    },
  };
}

export function mergeCollaborationSettings(
  existingSettings: unknown,
  updates: Partial<{
    asks: Partial<AsksSettings>;
    pulse: Partial<PulseSettings>;
    customerRequests: Partial<CustomerRequestsSettings>;
  }>,
) {
  const root = asRecord(existingSettings);
  const current = readCollaborationSettings(root);

  return {
    ...root,
    collaboration: {
      ...asRecord(root.collaboration),
      asks: {
        ...current.asks,
        ...updates.asks,
      },
      pulse: {
        ...current.pulse,
        ...updates.pulse,
      },
      customerRequests: {
        ...current.customerRequests,
        ...updates.customerRequests,
      },
    },
  };
}

export function parseCollaborationUpdate(body: unknown) {
  const record = asRecord(body);
  const updates: Partial<{
    asks: Partial<AsksSettings>;
    pulse: Partial<PulseSettings>;
    customerRequests: Partial<CustomerRequestsSettings>;
  }> = {};

  const asks = asRecord(record.asks);
  if (Object.keys(asks).length > 0) {
    updates.asks = {};
    if (typeof asks.enabled === "boolean") updates.asks.enabled = asks.enabled;
    if (typeof asks.intakeEmail === "string") {
      updates.asks.intakeEmail = asks.intakeEmail.trim().slice(0, 120);
    }
    if (
      typeof asks.defaultPriority === "string" &&
      PRIORITIES.has(asks.defaultPriority)
    ) {
      updates.asks.defaultPriority =
        asks.defaultPriority as AsksSettings["defaultPriority"];
    }
    if (typeof asks.autoAssign === "boolean") {
      updates.asks.autoAssign = asks.autoAssign;
    }
  }

  const customerRequests = asRecord(record.customerRequests);
  if (Object.keys(customerRequests).length > 0) {
    updates.customerRequests = {};
    if (typeof customerRequests.enabled === "boolean") {
      updates.customerRequests.enabled = customerRequests.enabled;
    }
    if (typeof customerRequests.intakeEmail === "string") {
      updates.customerRequests.intakeEmail = customerRequests.intakeEmail
        .trim()
        .slice(0, 120);
    }
    if (typeof customerRequests.defaultTeamKey === "string") {
      updates.customerRequests.defaultTeamKey = sanitizeTeamKey(
        customerRequests.defaultTeamKey,
      );
    }
    if (
      typeof customerRequests.linkMode === "string" &&
      CUSTOMER_REQUEST_LINK_MODES.has(customerRequests.linkMode)
    ) {
      updates.customerRequests.linkMode =
        customerRequests.linkMode as CustomerRequestsSettings["linkMode"];
    }
    if (typeof customerRequests.autoCreateIssues === "boolean") {
      updates.customerRequests.autoCreateIssues =
        customerRequests.autoCreateIssues;
    }
  }

  const pulse = asRecord(record.pulse);
  if (Object.keys(pulse).length > 0) {
    updates.pulse = {};
    if (typeof pulse.enabled === "boolean") {
      updates.pulse.enabled = pulse.enabled;
    }
    if (
      typeof pulse.digestFrequency === "string" &&
      DIGEST_FREQUENCIES.has(pulse.digestFrequency)
    ) {
      updates.pulse.digestFrequency =
        pulse.digestFrequency as PulseSettings["digestFrequency"];
    }
    if (typeof pulse.burnoutAlerts === "boolean") {
      updates.pulse.burnoutAlerts = pulse.burnoutAlerts;
    }
    if (
      typeof pulse.velocityTarget === "number" &&
      Number.isInteger(pulse.velocityTarget) &&
      pulse.velocityTarget > 0 &&
      pulse.velocityTarget <= 500
    ) {
      updates.pulse.velocityTarget = pulse.velocityTarget;
    }
  }

  return updates;
}
