"use client";

import { type SyncOperation, subscribeToSync } from "@namuh-eng/expn-sdk";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const SYNC_OPERATIONS_EVENT = "exponential:sync-operations";

export type SyncOperationsEvent = CustomEvent<{ operations: SyncOperation[] }>;

function browserApiBaseUrl() {
  if (typeof window === "undefined") return "http://localhost/api";
  return new URL("/api", window.location.origin).toString().replace(/\/$/, "");
}

function shouldRefreshRoute(operations: SyncOperation[]) {
  return operations.some((operation) =>
    ["issue", "comment", "project", "notification"].includes(
      operation.entity_type,
    ),
  );
}

export function SyncSubscription({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();

  useEffect(() => {
    const subscription = subscribeToSync({
      baseUrl: browserApiBaseUrl(),
      versionStore: {
        get() {
          const raw = window.localStorage.getItem(syncVersionKey(workspaceId));
          if (!raw) return undefined;
          const version = Number.parseInt(raw, 10);
          return Number.isFinite(version) && version >= 0 ? version : undefined;
        },
        set(version) {
          window.localStorage.setItem(
            syncVersionKey(workspaceId),
            String(version),
          );
        },
      },
      onOperations(operations) {
        window.dispatchEvent(
          new CustomEvent(SYNC_OPERATIONS_EVENT, { detail: { operations } }),
        );
        if (shouldRefreshRoute(operations)) {
          router.refresh();
        }
      },
      onError(error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Sync subscription error", error);
        }
      },
    });

    return () => subscription.close();
  }, [router, workspaceId]);

  return null;
}

function syncVersionKey(workspaceId: string) {
  return `exponential:sync:last-version:${workspaceId}`;
}
