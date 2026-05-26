"use client";

import {
  type DisplayProperties,
  type GroupByOption,
  type OrderByOption,
  defaultDisplayProperties,
} from "@/components/display-options-panel";
import { useCallback, useEffect, useState } from "react";

export interface DisplayOptionsState {
  layout: "list" | "board";
  groupBy: GroupByOption;
  subGroupBy: GroupByOption;
  orderBy: OrderByOption;
  displayProperties: DisplayProperties;
  showSubIssues: boolean;
  showTriageIssues: boolean;
  showEmptyColumns: boolean;
}

const DISPLAY_OPTIONS_STORAGE_PREFIX = "exponential-display-options:team:";

function getStorage(): Pick<Storage, "getItem" | "removeItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storage = window.localStorage;
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    return null;
  }

  return storage;
}

function readStoredDisplayOptions(teamKey: string) {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(`${DISPLAY_OPTIONS_STORAGE_PREFIX}${teamKey}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Partial<DisplayOptionsState>)
      : null;
  } catch {
    return null;
  }
}

export const defaultDisplayOptions: DisplayOptionsState = {
  layout: "list",
  groupBy: "status",
  subGroupBy: "none",
  orderBy: "priority",
  displayProperties: { ...defaultDisplayProperties },
  showSubIssues: true,
  showTriageIssues: false,
  showEmptyColumns: false,
};

export function useDisplayOptions(
  teamKey: string,
  initialLayout: "list" | "board",
) {
  const [options, setOptions] = useState<DisplayOptionsState>({
    ...defaultDisplayOptions,
    layout: initialLayout,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const storedOptions = readStoredDisplayOptions(teamKey);
        const res = await fetch(`/api/teams/${teamKey}/display-options`);
        const data = res.ok ? await res.json() : {};
        if (data.displayOptions || storedOptions) {
          setOptions((prev) => ({
            ...prev,
            ...data.displayOptions,
            ...storedOptions,
            layout: initialLayout,
          }));
        }
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, [teamKey, initialLayout]);

  const updateOptions = useCallback((update: Partial<DisplayOptionsState>) => {
    setOptions((prev) => {
      const next = { ...prev, ...update };
      return next;
    });
  }, []);

  const saveAsDefault = useCallback(async () => {
    await fetch(`/api/teams/${teamKey}/display-options`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayOptions: options }),
    });
  }, [teamKey, options]);

  const reset = useCallback(() => {
    setOptions({ ...defaultDisplayOptions, layout: options.layout });
  }, [options.layout]);

  return { options, loaded, updateOptions, saveAsDefault, reset };
}
