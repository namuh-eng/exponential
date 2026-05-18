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
        const res = await fetch(`/api/teams/${teamKey}/display-options`);
        if (res.ok) {
          const data = await res.json();
          if (data.displayOptions) {
            setOptions((prev) => ({
              ...prev,
              ...data.displayOptions,
              layout: initialLayout,
            }));
          }
        }
        try {
          const rawSavedViewOptions = window.localStorage.getItem(
            `exponential-display-options:team:${teamKey}`,
          );
          if (rawSavedViewOptions) {
            const savedViewOptions = JSON.parse(rawSavedViewOptions);
            setOptions((prev) => ({
              ...prev,
              groupBy: savedViewOptions.groupBy ?? prev.groupBy,
              orderBy: savedViewOptions.orderBy ?? prev.orderBy,
              displayProperties:
                savedViewOptions.visibleProperties ?? prev.displayProperties,
              layout:
                savedViewOptions.layout === "board" ? "board" : initialLayout,
            }));
          }
        } catch {
          // Ignore malformed saved view display options.
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
