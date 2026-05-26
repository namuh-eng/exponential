import { getConfiguredAppUrl } from "@/lib/app-url";

export function isPasskeyAuthEnabled() {
  return process.env.PASSKEY_AUTH_DISABLED !== "true";
}

export function getPasskeyRpID() {
  try {
    return new URL(getConfiguredAppUrl()).hostname;
  } catch {
    return "localhost";
  }
}

export function getPasskeyOrigin() {
  return getConfiguredAppUrl().replace(/\/$/u, "");
}
