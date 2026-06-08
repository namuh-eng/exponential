"use client";

import {
  LAST_ISSUE_STORAGE_KEY,
  OPEN_ASK_LINEAR_EVENT,
  OPEN_COMMAND_PALETTE_EVENT,
  OPEN_CREATE_ISSUE_EVENT,
  OPEN_CREATE_ISSUE_FULLSCREEN_EVENT,
  OPEN_PROJECT_UPDATE_EVENT,
} from "@/lib/command-palette";
import {
  isCommandPaletteShortcut,
  isEditableShortcutTarget,
  isSlashCommandPaletteShortcut,
} from "@/lib/keyboard-shortcuts";
import { stripWorkspaceSlug, withWorkspaceSlug } from "@/lib/workspace-paths";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

interface CommandPaletteProps {
  teamKey: string;
  workspaceId?: string;
  workspaceSlug?: string;
}

interface SearchResult {
  id: string;
  identifier: string;
  title: string;
  priority: string;
  teamKey?: string;
  path?: string;
}

interface ProjectPickerItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  teams: { id: string; key: string; name: string }[];
}

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  group: string;
  closeOnSelect?: boolean;
  action: () => void;
}

function getIssueTeamKey(result: SearchResult) {
  if (result.teamKey) {
    return result.teamKey;
  }

  const identifierTeamKey = result.identifier.match(
    /^([A-Za-z][A-Za-z0-9]*)-/,
  )?.[1];
  return identifierTeamKey ?? null;
}

function getIssuePath(result: SearchResult) {
  const issueTeamKey = getIssueTeamKey(result);
  if (!issueTeamKey) {
    return `/issue/${result.id}`;
  }

  return `/team/${encodeURIComponent(issueTeamKey)}/issue/${encodeURIComponent(
    result.identifier,
  )}`;
}

export function CommandPalette({
  teamKey,
  workspaceId,
  workspaceSlug,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectPickerQuery, setProjectPickerQuery] = useState("");
  const [projects, setProjects] = useState<ProjectPickerItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectPickerError, setProjectPickerError] = useState<string | null>(
    null,
  );
  const [selectedProjectIndex, setSelectedProjectIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const projectPickerInputRef = useRef<HTMLInputElement>(null);
  const projectShortcutRef = useRef<{ key: string; timestamp: number } | null>(
    null,
  );
  const router = useRouter();
  const pathname = stripWorkspaceSlug(usePathname(), workspaceSlug);
  const goTo = useCallback(
    (path: string) => router.push(withWorkspaceSlug(path, workspaceSlug)),
    [router, workspaceSlug],
  );
  const getIssueResultPath = useCallback(
    (result: SearchResult) =>
      result.path ??
      `/team/${encodeURIComponent(result.teamKey ?? teamKey)}/issue/${encodeURIComponent(result.identifier)}`,
    [teamKey],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const latestSearchRequestRef = useRef(0);
  const currentProjectSlug = pathname.match(/^\/project\/([^/]+)/)?.[1];

  const close = useCallback((restoreFocus = true) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setOpen(false);
    setQuery("");
    setResults([]);
    setSearching(false);
    setSelectedIndex(0);
    if (restoreFocus && lastFocusedElementRef.current) {
      requestAnimationFrame(() => lastFocusedElementRef.current?.focus());
    }
  }, []);

  const openProjectUpdateFlow = useCallback(() => {
    if (currentProjectSlug) {
      window.dispatchEvent(new CustomEvent(OPEN_PROJECT_UPDATE_EVENT));
      goTo(
        `/project/${decodeURIComponent(currentProjectSlug)}/overview?newUpdate=1`,
      );
      return;
    }

    setProjectPickerOpen(true);
    setProjectPickerQuery("");
    setSelectedProjectIndex(0);
  }, [currentProjectSlug, goTo]);

  const openProjectUpdateForProject = useCallback(
    (projectSlug: string) => {
      setProjectPickerOpen(false);
      setProjectPickerQuery("");
      goTo(`/project/${projectSlug}/overview?newUpdate=1`);
    },
    [goTo],
  );

  const closeProjectPicker = useCallback(() => {
    setProjectPickerOpen(false);
    setProjectPickerQuery("");
    setSelectedProjectIndex(0);
    if (lastFocusedElementRef.current) {
      requestAnimationFrame(() => lastFocusedElementRef.current?.focus());
    }
  }, []);

  const executeCommand = useCallback(
    (command: CommandItem) => {
      if (command.closeOnSelect !== false) {
        close();
      }
      command.action();
    },
    [close],
  );

  const openLastIssue = useCallback(() => {
    const lastIssueId = window.localStorage.getItem(LAST_ISSUE_STORAGE_KEY);
    if (lastIssueId) {
      goTo(`/issue/${lastIssueId}`);
      return;
    }

    goTo(`/team/${teamKey}/all`);
  }, [goTo, teamKey]);

  // Commands
  const commands: CommandItem[] = [
    {
      id: "ask-linear",
      label: "Ask exponential",
      shortcut: "A",
      group: "Ask",
      action: () => {
        window.dispatchEvent(new CustomEvent(OPEN_ASK_LINEAR_EVENT));
      },
    },
    {
      id: "create-view",
      label: "Create view",
      group: "Views",
      action: () => {
        goTo("/views");
      },
    },
    {
      id: "create-issue",
      label: "Create new issue",
      shortcut: "C",
      group: "Issues",
      action: () => {
        window.dispatchEvent(new CustomEvent(OPEN_CREATE_ISSUE_EVENT));
      },
    },
    {
      id: "create-issue-fullscreen",
      label: "Create in fullscreen",
      shortcut: "V",
      group: "Issues",
      action: () => {
        window.dispatchEvent(
          new CustomEvent(OPEN_CREATE_ISSUE_FULLSCREEN_EVENT),
        );
      },
    },
    {
      id: "create-label",
      label: "Create label",
      group: "Issues",
      action: () => {
        goTo("/settings/issue-labels");
      },
    },
    {
      id: "new-project-update",
      label: "New project update",
      shortcut: "N U",
      group: "Projects",
      action: openProjectUpdateFlow,
    },
    {
      id: "create-project",
      label: "Create project",
      shortcut: "N P",
      group: "Projects",
      action: () => {
        goTo("/projects/all");
      },
    },
    {
      id: "create-document",
      label: "Create document",
      group: "Documents",
      action: () => {
        goTo("/views");
      },
    },
    {
      id: "search-workspace",
      label: "Search workspace",
      group: "Filter",
      closeOnSelect: true,
      action: () => {
        if (query.trim()) {
          goTo(`/search?q=${encodeURIComponent(query.trim())}`);
        } else {
          inputRef.current?.focus();
        }
      },
    },
    {
      id: "find-view",
      label: "Find view",
      shortcut: "Cmd F",
      group: "Filter",
      action: () => {
        goTo("/views");
      },
    },
    {
      id: "issue-template",
      label: "Issue template",
      group: "Templates",
      action: () => {
        window.dispatchEvent(new CustomEvent(OPEN_CREATE_ISSUE_EVENT));
      },
    },
    {
      id: "document-template",
      label: "Document template",
      group: "Templates",
      action: () => {
        goTo("/views");
      },
    },
    {
      id: "project-template",
      label: "Project template",
      group: "Templates",
      action: () => {
        goTo("/projects/all");
      },
    },
    {
      id: "open-last-issue",
      label: "Open last issue",
      group: "Navigation",
      action: openLastIssue,
    },
    {
      id: "open-in-desktop",
      label: "Open in desktop",
      group: "Navigation",
      action: () => {
        goTo("/settings/account/preferences");
      },
    },
    {
      id: "go-to-inbox",
      label: "Go to Inbox",
      group: "Navigation",
      action: () => {
        goTo("/inbox");
      },
    },
    {
      id: "go-to-my-issues",
      label: "Go to My Issues",
      group: "Navigation",
      action: () => {
        goTo("/my-issues/assigned");
      },
    },
    {
      id: "go-to-issues",
      label: "Go to Issues",
      group: "Navigation",
      action: () => {
        goTo(`/team/${teamKey}/all`);
      },
    },
    {
      id: "go-to-board",
      label: "Go to Board",
      group: "Navigation",
      action: () => {
        goTo(`/team/${teamKey}/board`);
      },
    },
  ];

  // Filter commands by query
  const filteredCommands = query
    ? commands.filter((cmd) =>
        cmd.label.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Group commands
  const groupedCommands = filteredCommands.reduce<
    Record<string, CommandItem[]>
  >((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = [];
    acc[cmd.group].push(cmd);
    return acc;
  }, {});

  // Total selectable items: search results + filtered commands
  const totalItems = results.length + filteredCommands.length;

  // Search issues when query changes
  useEffect(() => {
    if (!open) return;

    if (!query || query.length < 2) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();

    debounceRef.current = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      const abortController = new AbortController();
      searchAbortRef.current = abortController;
      setSearching(true);
      try {
        const searchParams = new URLSearchParams({ q: query });
        if (workspaceId) {
          searchParams.set("workspaceId", workspaceId);
        }

        const res = await fetch(
          `/api/issues/search?${searchParams.toString()}`,
          {
            signal: abortController.signal,
          },
        );
        if (res.ok) {
          const data = await res.json();
          if (latestSearchRequestRef.current === requestId) {
            setResults(data);
          }
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          throw error;
        }
      } finally {
        if (latestSearchRequestRef.current === requestId) {
          setSearching(false);
        }
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, workspaceId]);

  useEffect(() => {
    if (!projectPickerOpen) return;

    const abortController = new AbortController();
    setProjectsLoading(true);
    setProjectPickerError(null);

    fetch("/api/projects", { signal: abortController.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Unable to load projects.");
        }
        return res.json();
      })
      .then((data) => {
        setProjects(data.projects ?? []);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setProjects([]);
        setProjectPickerError("Unable to load projects.");
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setProjectsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [projectPickerOpen]);

  useEffect(() => {
    if (projectPickerOpen) {
      requestAnimationFrame(() => projectPickerInputRef.current?.focus());
    }
  }, [projectPickerOpen]);

  // Global Cmd/Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableShortcutTarget(e.target)) {
        projectShortcutRef.current = null;
        return;
      }

      if (isCommandPaletteShortcut(e) || isSlashCommandPaletteShortcut(e)) {
        e.preventDefault();
        if (!open) {
          lastFocusedElementRef.current = document.activeElement as HTMLElement;
        }
        setOpen((prev) => !prev);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
        return;
      }

      const key = e.key.toLowerCase();
      const now = Date.now();
      if (
        key === "u" &&
        projectShortcutRef.current?.key === "n" &&
        now - projectShortcutRef.current.timestamp < 1250
      ) {
        e.preventDefault();
        projectShortcutRef.current = null;
        lastFocusedElementRef.current = document.activeElement as HTMLElement;
        close(false);
        openProjectUpdateFlow();
        return;
      }

      projectShortcutRef.current = key === "n" ? { key, timestamp: now } : null;
    }

    function handleOpenPalette() {
      lastFocusedElementRef.current = document.activeElement as HTMLElement;
      setOpen(true);
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
    };
  }, [close, open, openProjectUpdateFlow]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset selected index when items change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on query/results change intentionally
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, results.length]);

  // Keyboard navigation within palette
  const handlePaletteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(totalItems, 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) =>
            (prev - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1),
        );
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex < results.length) {
          // Navigate to issue
          const result = results[selectedIndex];
          close();
          goTo(getIssueResultPath(result));
        } else if (selectedIndex >= totalItems && results.length > 0) {
          // Results can arrive asynchronously while the selected index still
          // points at a now-filtered command. Keep Enter deterministic by
          // falling back to the first visible result instead of no-oping.
          close();
          goTo(getIssueResultPath(results[0]));
        } else {
          const cmdIndex = selectedIndex - results.length;
          if (cmdIndex < filteredCommands.length) {
            executeCommand(filteredCommands[cmdIndex]);
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      close,
      executeCommand,
      filteredCommands,
      getIssueResultPath,
      goTo,
      results,
      selectedIndex,
      totalItems,
    ],
  );

  const filteredProjects = projects.filter((project) =>
    project.name.toLowerCase().includes(projectPickerQuery.toLowerCase()),
  );
  const selectedProject = filteredProjects[selectedProjectIndex];
  const selectedCommand =
    selectedIndex >= results.length
      ? filteredCommands[selectedIndex - results.length]
      : null;
  const selectedResult =
    selectedIndex < results.length ? results[selectedIndex] : null;
  const selectedStatus = selectedResult
    ? "issue result ready"
    : selectedCommand
      ? "command ready"
      : query
        ? "no matching command"
        : "choose a command";

  function handleProjectPickerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeProjectPicker();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedProjectIndex(
        (prev) => (prev + 1) % Math.max(filteredProjects.length, 1),
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedProjectIndex(
        (prev) =>
          (prev - 1 + Math.max(filteredProjects.length, 1)) %
          Math.max(filteredProjects.length, 1),
      );
      return;
    }

    if (e.key === "Enter" && selectedProject) {
      e.preventDefault();
      openProjectUpdateForProject(selectedProject.slug);
    }
  }

  if (!open && !projectPickerOpen) return null;

  let itemIndex = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-3 pt-[12vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-[rgba(12,13,12,0.55)] backdrop-blur-[2px]"
        onClick={() => (projectPickerOpen ? closeProjectPicker() : close())}
        onKeyDown={(e) =>
          e.key === "Escape" &&
          (projectPickerOpen ? closeProjectPicker() : close())
        }
        role="presentation"
      />

      {/* Palette */}
      {open ? (
        <dialog
          open
          className="tty-panel relative z-10 flex w-full max-w-[720px] flex-col overflow-hidden shadow-[var(--shadow-editorial-md)]"
          aria-label="Command palette"
          onKeyDown={handlePaletteKeyDown}
        >
          {/* Search input */}
          <div className="tty-prompt-line px-4 py-3">
            <span className="shrink-0 text-[var(--color-accent)]">exp</span>
            <span aria-hidden="true">$</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search..."
              className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none"
            />
            {searching && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-text-secondary)] border-t-transparent" />
            )}
            <kbd className="tty-kbd">ESC</kbd>
          </div>

          {/* Results */}
          <div className="max-h-[420px] overflow-y-auto px-2 py-2">
            {/* Search results */}
            {results.length > 0 && (
              <div>
                <div className="px-2 py-1.5 font-mono text-[10px] uppercase text-[var(--color-text-secondary)]">
                  Quick results for &ldquo;{query}&rdquo;
                </div>
                {results.map((result) => {
                  const idx = itemIndex++;
                  return (
                    <button
                      key={result.id}
                      type="button"
                      className={`tty-row grid w-full grid-cols-[16px_minmax(64px,92px)_minmax(0,1fr)] items-center gap-3 px-2 py-1.5 text-left ${
                        selectedIndex === idx
                          ? "tty-row-selected bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-primary)]"
                      }`}
                      onClick={() => {
                        close();
                        goTo(getIssueResultPath(result));
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <PriorityDot priority={result.priority} />
                      <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
                        {result.identifier}
                      </span>
                      <span className="truncate text-[13px]">
                        {result.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Commands */}
            {Object.entries(groupedCommands).map(([group, cmds]) => (
              <div key={group}>
                <div className="px-2 py-1.5 font-mono text-[10px] uppercase text-[var(--color-text-secondary)]">
                  {group}
                </div>
                {cmds.map((cmd) => {
                  const idx = itemIndex++;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      className={`tty-row grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-1.5 text-left ${
                        selectedIndex === idx
                          ? "tty-row-selected bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-primary)]"
                      }`}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="truncate text-[13px]">{cmd.label}</span>
                      {cmd.shortcut && (
                        <span className="ml-auto flex items-center gap-1">
                          {cmd.shortcut.split(" ").map((key) => (
                            <kbd
                              key={key}
                              className={`tty-kbd ${
                                selectedIndex === idx
                                  ? "border-[var(--color-accent)] text-[var(--color-text-primary)]"
                                  : "text-[var(--color-text-secondary)]"
                              }`}
                            >
                              {key}
                            </kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Empty state */}
            {totalItems === 0 && query && (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                No results found for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="tty-status-bar min-h-[34px] flex-wrap border-t px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">
              selected: {selectedStatus}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="tty-kbd">&crarr;</kbd>
              Open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="tty-kbd">⌘</kbd>
              <kbd className="tty-kbd">/</kbd>
              Advanced search
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <kbd className="tty-kbd">&uarr;</kbd>
              <kbd className="tty-kbd">&darr;</kbd>
              More actions
            </span>
          </div>
        </dialog>
      ) : null}

      {projectPickerOpen ? (
        <dialog
          open
          className="tty-panel relative z-10 flex w-full max-w-[560px] flex-col overflow-hidden shadow-[var(--shadow-editorial-md)]"
          aria-label="Choose a project for update"
          onKeyDown={handleProjectPickerKeyDown}
        >
          <div className="tty-prompt-line px-4 py-3">
            <span className="shrink-0 text-[var(--color-accent)]">project</span>
            <span aria-hidden="true">$</span>
            <input
              ref={projectPickerInputRef}
              type="text"
              value={projectPickerQuery}
              onChange={(e) => {
                setProjectPickerQuery(e.target.value);
                setSelectedProjectIndex(0);
              }}
              placeholder="Search projects..."
              aria-label="Search projects for update"
              className="min-w-0 flex-1 bg-transparent font-mono text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none"
            />
          </div>
          <div className="max-h-[340px] overflow-y-auto px-2 py-2">
            {projectsLoading ? (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                Loading projects...
              </div>
            ) : null}
            {projectPickerError ? (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                {projectPickerError}
              </div>
            ) : null}
            {!projectsLoading &&
            !projectPickerError &&
            filteredProjects.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
                No projects found.
              </div>
            ) : null}
            {!projectsLoading && !projectPickerError
              ? filteredProjects.map((project, index) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`tty-row grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left ${
                      selectedProjectIndex === index
                        ? "tty-row-selected bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-primary)]"
                    }`}
                    onClick={() => openProjectUpdateForProject(project.slug)}
                    onMouseEnter={() => setSelectedProjectIndex(index)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {project.name}
                      </span>
                      <span
                        className={`block truncate text-[12px] ${
                          selectedProjectIndex === index
                            ? "text-[var(--color-text-secondary)]"
                            : "text-[var(--color-text-secondary)]"
                        }`}
                      >
                        {(project.teams ?? []).length > 0
                          ? (project.teams ?? [])
                              .map((team) => team.key)
                              .join(", ")
                          : "Workspace project"}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                        selectedProjectIndex === index
                          ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {project.status}
                    </span>
                  </button>
                ))
              : null}
          </div>
          <div className="tty-status-bar justify-between border-t px-4 py-2">
            <span>
              selected: {selectedProject ? "project ready" : "choose project"}
            </span>
            <button
              type="button"
              onClick={closeProjectPicker}
              className="tty-row px-2 py-1 text-[11px] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    urgent: "#ef4444",
    high: "#f97316",
    medium: "#eab308",
    low: "#3b82f6",
    none: "#6b7280",
  };
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: colors[priority] || colors.none }}
    />
  );
}
