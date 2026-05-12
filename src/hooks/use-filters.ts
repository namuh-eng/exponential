"use client";

import type {
  FilterCondition,
  FilterOperator,
  FilterType,
} from "@/components/filter-bar";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const FILTER_STORAGE_PREFIX = "whetline-filters:";
const FILTER_TYPES = new Set<FilterType>([
  "status",
  "priority",
  "assignee",
  "label",
  "project",
  "cycle",
  "creator",
  "dueDate",
  "estimate",
]);
const FILTER_OPERATORS = new Set<FilterOperator>(["is", "isNot"]);

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

function readStoredFilters(storageKey: string): FilterCondition[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FilterCondition[]) : [];
  } catch {
    return [];
  }
}

/**
 * Encodes filters into a string format suitable for URL query parameters.
 * Format: type:operator:val1,val2;type:operator:val3
 */
function encodeFiltersToQuery(filters: FilterCondition[]): string {
  if (filters.length === 0) return "";
  return filters
    .map((f) => `${f.type}:${f.operator}:${f.values.join(",")}`)
    .join(";");
}

/**
 * Decodes filters from a query string.
 */
function decodeFiltersFromQuery(query: string): FilterCondition[] {
  if (!query) return [];
  const parts = query.split(";");
  const filters: FilterCondition[] = [];

  for (const part of parts) {
    const [type, operator, valuesStr] = part.split(":");
    if (
      type &&
      operator &&
      valuesStr &&
      FILTER_TYPES.has(type as FilterType) &&
      FILTER_OPERATORS.has(operator as FilterOperator)
    ) {
      filters.push({
        type: type as FilterType,
        operator: operator as FilterOperator,
        values: valuesStr.split(","),
      });
    }
  }

  return filters;
}

export function useFilters(scope: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storageKey = useMemo(() => `${FILTER_STORAGE_PREFIX}${scope}`, [scope]);

  // Initial filters from URL or LocalStorage
  const [filters, setFilters] = useState<FilterCondition[]>(() => {
    const queryFilters = searchParams.get("f");
    if (queryFilters) {
      return decodeFiltersFromQuery(queryFilters);
    }
    return readStoredFilters(storageKey);
  });

  // Sync from URL changes (back/forward navigation)
  useEffect(() => {
    const queryFilters = searchParams.get("f");
    if (queryFilters) {
      const decoded = decodeFiltersFromQuery(queryFilters);
      if (JSON.stringify(decoded) !== JSON.stringify(filters)) {
        setFilters(decoded);
      }
    } else if (filters.length > 0) {
      // If URL has no filters but state does, check if we should reset or keep local
      // For now, we prefer the URL as the source of truth if the param is present.
      // If the param is missing but we're on a route that typically has them,
      // we might want to stay with what we have.
    }
  }, [searchParams, filters]);

  // Sync to LocalStorage and URL
  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;

    if (filters.length === 0) {
      storage.removeItem(storageKey);
      if (searchParams.has("f")) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("f");
        const query = params.toString() ? `?${params.toString()}` : "";
        router.replace(`${pathname}${query}`);
      }
      return;
    }

    storage.setItem(storageKey, JSON.stringify(filters));

    // Update URL query param
    const encoded = encodeFiltersToQuery(filters);
    if (searchParams.get("f") !== encoded) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("f", encoded);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [filters, storageKey, pathname, router, searchParams]);

  const updateFilters = useCallback((newFilters: FilterCondition[]) => {
    setFilters(newFilters);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters([]);
  }, []);

  return { filters, updateFilters, clearFilters };
}
