export type KeyboardShortcutCategory =
  | "Command"
  | "Create"
  | "Navigation"
  | "Context";

export type KeyboardShortcutScope = "global" | "contextual";

export type KeyboardShortcutAction =
  | "open-command-palette"
  | "open-create-issue"
  | "open-create-issue-fullscreen"
  | "open-keyboard-shortcuts"
  | "go-to-inbox"
  | "go-to-my-issues"
  | "go-to-views"
  | "go-to-projects"
  | "open-project-update"
  | "close-current-surface"
  | "create-initiative";

export interface KeyboardShortcutDefinition {
  id: string;
  label: string;
  keys: string[];
  category: KeyboardShortcutCategory;
  scope: KeyboardShortcutScope;
  action: KeyboardShortcutAction;
  description?: string;
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcutDefinition[] = [
  {
    id: "open-command-palette",
    label: "Open command menu / search",
    keys: ["Cmd/Ctrl", "K"],
    category: "Command",
    scope: "global",
    action: "open-command-palette",
    description: "Search issues and run workspace commands.",
  },
  {
    id: "open-keyboard-shortcuts",
    label: "Open keyboard shortcuts",
    keys: ["/"],
    category: "Command",
    scope: "global",
    action: "open-keyboard-shortcuts",
  },
  {
    id: "create-issue",
    label: "Create issue",
    keys: ["C"],
    category: "Create",
    scope: "global",
    action: "open-create-issue",
  },
  {
    id: "create-issue-fullscreen",
    label: "Create issue fullscreen",
    keys: ["V"],
    category: "Create",
    scope: "global",
    action: "open-create-issue-fullscreen",
  },

  {
    id: "open-project-update",
    label: "New project update",
    keys: ["N", "U"],
    category: "Create",
    scope: "global",
    action: "open-project-update",
  },
  {
    id: "go-to-inbox",
    label: "Go to Inbox",
    keys: ["G", "I"],
    category: "Navigation",
    scope: "global",
    action: "go-to-inbox",
  },
  {
    id: "go-to-my-issues",
    label: "Go to My issues",
    keys: ["G", "M"],
    category: "Navigation",
    scope: "global",
    action: "go-to-my-issues",
  },
  {
    id: "go-to-views",
    label: "Go to Views",
    keys: ["G", "V"],
    category: "Navigation",
    scope: "global",
    action: "go-to-views",
  },
  {
    id: "go-to-projects",
    label: "Go to Projects",
    keys: ["G", "P"],
    category: "Navigation",
    scope: "global",
    action: "go-to-projects",
  },
  {
    id: "create-initiative",
    label: "Create initiative",
    keys: ["N", "I"],
    category: "Create",
    scope: "contextual",
    action: "create-initiative",
    description: "Available on the Initiatives page.",
  },
  {
    id: "close-current-surface",
    label: "Close modal or panel",
    keys: ["Esc"],
    category: "Context",
    scope: "contextual",
    action: "close-current-surface",
  },
];

export const GLOBAL_SHORTCUT_ACTIONS = new Set<KeyboardShortcutAction>([
  "open-command-palette",
  "open-create-issue",
  "open-create-issue-fullscreen",
  "open-keyboard-shortcuts",
  "go-to-inbox",
  "go-to-my-issues",
  "go-to-views",
  "go-to-projects",
  "open-project-update",
]);

export function getShortcutByAction(action: KeyboardShortcutAction) {
  return KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.action === action);
}

export function getShortcutById(id: string) {
  return KEYBOARD_SHORTCUTS.find((shortcut) => shortcut.id === id);
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    target.closest('[contenteditable=""], [contenteditable="true"]') !== null ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function isPlainKeyShortcut(event: KeyboardEvent, key: string): boolean {
  return (
    event.key.toLowerCase() === key.toLowerCase() &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !isEditableShortcutTarget(event.target)
  );
}

export function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    (event.key.toLowerCase() === "k" || event.code === "KeyK") &&
    !isEditableShortcutTarget(event.target)
  );
}

export function formatShortcutKeys(keys: string[]) {
  return keys.join(" then ");
}
