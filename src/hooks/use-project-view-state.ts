"use client";

import type {
  ProjectViewSortOption,
  ProjectViewStatusFilter,
} from "@/lib/views";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ProjectViewState {
  statusFilter: ProjectViewStatusFilter;
  sortBy: ProjectViewSortOption;
  teamId: string | null;
}

const PROJECT_VIEW_STORAGE_PREFIX = "exponential-project-view:";

const defaultProjectViewState: ProjectViewState = {
  statusFilter: "all",
  sortBy: "created-desc",
  teamId: null,
};

function getStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return null;
  }

  return storage;
}

function readStoredProjectViewState(storageKey: string): ProjectViewState {
  const storage = getStorage();
  if (!storage) {
    return defaultProjectViewState;
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return defaultProjectViewState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectViewState>;
    return {
      statusFilter:
        parsed.statusFilter === "planned" ||
        parsed.statusFilter === "started" ||
        parsed.statusFilter === "paused" ||
        parsed.statusFilter === "completed" ||
        parsed.statusFilter === "canceled"
          ? parsed.statusFilter
          : "all",
      sortBy:
        parsed.sortBy === "created-asc" ||
        parsed.sortBy === "name-asc" ||
        parsed.sortBy === "progress-desc" ||
        parsed.sortBy === "target-date-asc"
          ? parsed.sortBy
          : "created-desc",
      teamId: typeof parsed.teamId === "string" ? parsed.teamId : null,
    };
  } catch {
    return defaultProjectViewState;
  }
}

export function useProjectViewState(scope: string) {
  const storageKey = useMemo(
    () => `${PROJECT_VIEW_STORAGE_PREFIX}${scope}`,
    [scope],
  );
  const [state, setState] = useState<ProjectViewState>(() =>
    readStoredProjectViewState(storageKey),
  );

  useEffect(() => {
    setState(readStoredProjectViewState(storageKey));
  }, [storageKey]);

  useEffect(() => {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    if (
      state.statusFilter === defaultProjectViewState.statusFilter &&
      state.sortBy === defaultProjectViewState.sortBy &&
      state.teamId === defaultProjectViewState.teamId
    ) {
      storage.removeItem(storageKey);
      return;
    }

    storage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  const updateState = useCallback((update: Partial<ProjectViewState>) => {
    setState((current) => ({ ...current, ...update }));
  }, []);

  const clearState = useCallback(() => {
    setState(defaultProjectViewState);
  }, []);

  return { state, updateState, clearState };
}
