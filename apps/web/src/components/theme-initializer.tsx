"use client";

import {
  applyFontSizePreference,
  applyPointerCursorPreference,
  readAccountPreferencesFromUserSettings,
} from "@/lib/account-preferences";
import {
  APP_THEME_CHANGE_EVENT,
  applyTheme,
  getStoredTheme,
  setThemePreference,
} from "@/lib/theme";
import { useEffect } from "react";

const publicPreferenceSkipPaths = new Set([
  "/login",
  "/signup",
  "/homepage",
  "/pricing",
  "/customers",
  "/changelog",
  "/now",
]);

function shouldLoadAccountPreferences(pathname: string) {
  return !publicPreferenceSkipPaths.has(pathname);
}

export function ThemeInitializer() {
  useEffect(() => {
    const syncTheme = () => {
      applyTheme(getStoredTheme());
    };

    const mediaQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const handleMediaChange = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    };

    syncTheme();
    applyFontSizePreference("default");
    applyPointerCursorPreference(false);
    window.addEventListener(APP_THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);
    mediaQuery?.addEventListener("change", handleMediaChange);

    if (shouldLoadAccountPreferences(window.location.pathname)) {
      void fetch("/api/account/preferences", { credentials: "include" })
        .then(async (response) => {
          if (!response.ok) {
            return null;
          }

          return (await response.json()) as { accountPreferences?: unknown };
        })
        .then((data) => {
          if (!data?.accountPreferences) {
            return;
          }

          const accountPreferences = readAccountPreferencesFromUserSettings({
            accountPreferences: data.accountPreferences,
          });
          setThemePreference(accountPreferences.theme);
          applyFontSizePreference(accountPreferences.fontSize);
          applyPointerCursorPreference(accountPreferences.pointerCursors);
        })
        .catch(() => {
          applyFontSizePreference("default");
          applyPointerCursorPreference(false);
        });
    }

    return () => {
      window.removeEventListener(APP_THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
      mediaQuery?.removeEventListener("change", handleMediaChange);
    };
  }, []);

  return null;
}
