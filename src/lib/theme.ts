export const APP_THEME_STORAGE_KEY = "exponential-theme";
export const APP_THEME_CHANGE_EVENT = "exponential:theme-change";

export type AppTheme = "system" | "light" | "dark";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "system";
  }

  const storedTheme = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
  return isAppTheme(storedTheme) ? storedTheme : "system";
}

function prefersDarkMode(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(theme: AppTheme): "light" | "dark" {
  if (theme === "system") {
    return prefersDarkMode() ? "dark" : "light";
  }

  return theme;
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedTheme = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

export function setThemePreference(theme: AppTheme) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new Event(APP_THEME_CHANGE_EVENT));
  }

  applyTheme(theme);
}
