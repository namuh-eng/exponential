"use client";

import { Avatar } from "@/components/avatar";
import { usePathname, useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

interface WorkspaceData {
  id: string | null;
  name: string;
  urlSlug: string;
  logo: string | null;
  region: string;
  fiscalMonth: string;
  welcomeMessage: string;
}

function validateWorkspaceSlug(value: string) {
  if (value.length < 2 || value.length > 63) {
    return "URL slug must be between 2 and 63 characters";
  }

  if (value.trim() !== value) {
    return "URL slug cannot include leading or trailing spaces";
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return "URL slug can only use lowercase letters, numbers, and single hyphens";
  }

  return null;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="mt-8 mb-3 border-b border-[var(--color-border)] pb-2 text-[13px] font-medium text-[var(--color-text-primary)]">
      {title}
    </h3>
  );
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [workspace, setWorkspace] = useState<WorkspaceData>({
    id: null,
    name: "",
    urlSlug: "",
    logo: null,
    region: "United States",
    fiscalMonth: "january",
    welcomeMessage: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedLogoName, setSelectedLogoName] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [welcomeDialogOpen, setWelcomeDialogOpen] = useState(false);
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/workspaces/current")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load workspace");
        }

        return (await res.json()) as {
          workspace?: Partial<WorkspaceData>;
        };
      })
      .then((data) => {
        if (data?.workspace) {
          setWorkspace({
            id: data.workspace.id ?? null,
            name: data.workspace.name ?? "",
            urlSlug: data.workspace.urlSlug ?? "",
            logo: data.workspace.logo ?? null,
            region: data.workspace.region ?? "United States",
            fiscalMonth: data.workspace.fiscalMonth ?? "january",
            welcomeMessage:
              typeof data.workspace.welcomeMessage === "string"
                ? data.workspace.welcomeMessage
                : "",
          });
        }
      })
      .catch(() => {
        setErrorMessage("Unable to load workspace settings.");
      })
      .finally(() => setLoading(false));
  }, []);

  const saveWorkspace = async (nextWorkspace: WorkspaceData) => {
    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/workspaces/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextWorkspace.name,
          urlSlug: nextWorkspace.urlSlug,
          logo: nextWorkspace.logo,
          fiscalMonth: nextWorkspace.fiscalMonth,
          welcomeMessage: nextWorkspace.welcomeMessage,
        }),
      });

      const data = (await response.json().catch(() => null)) as {
        error?: string;
        workspace?: Partial<WorkspaceData>;
      } | null;

      if (!response.ok || !data?.workspace) {
        setErrorMessage(data?.error ?? "Unable to update workspace.");
        return;
      }

      setWorkspace((currentWorkspace) => ({
        ...currentWorkspace,
        id: data.workspace?.id ?? currentWorkspace.id,
        name: data.workspace?.name ?? currentWorkspace.name,
        urlSlug: data.workspace?.urlSlug ?? currentWorkspace.urlSlug,
        logo:
          data.workspace?.logo === undefined
            ? currentWorkspace.logo
            : data.workspace.logo,
        region: data.workspace?.region ?? currentWorkspace.region,
        fiscalMonth:
          data.workspace?.fiscalMonth ?? currentWorkspace.fiscalMonth,
        welcomeMessage:
          typeof data.workspace?.welcomeMessage === "string"
            ? data.workspace.welcomeMessage
            : currentWorkspace.welcomeMessage,
      }));
      setStatusMessage("Workspace updated.");
      const returnedSlug = data.workspace?.urlSlug;
      if (returnedSlug && returnedSlug !== nextWorkspace.urlSlug) {
        setErrorMessage(
          "Workspace saved, but the server returned an unexpected URL slug.",
        );
      }
      if (returnedSlug && pathname.includes("/settings/workspace")) {
        router.replace(
          `/${encodeURIComponent(returnedSlug)}/settings/workspace`,
        );
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleFieldBlur = () => {
    const nextSlugError = validateWorkspaceSlug(workspace.urlSlug);
    setSlugError(nextSlugError);
    if (nextSlugError) return;
    void saveWorkspace(workspace);
  };

  const handleWelcomeConfigure = () => {
    setWelcomeDraft(workspace.welcomeMessage);
    setWelcomeDialogOpen(true);
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const handleWelcomeSave = async () => {
    const nextWorkspace = { ...workspace, welcomeMessage: welcomeDraft };
    await saveWorkspace(nextWorkspace);
    setWelcomeDialogOpen(false);
  };

  const handleLogoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedLogoName(file.name);
    setStatusMessage(null);
    setErrorMessage(null);

    const reader = new FileReader();
    reader.onload = () => {
      const logo = typeof reader.result === "string" ? reader.result : null;
      const nextWorkspace = { ...workspace, logo };
      setWorkspace(nextWorkspace);
      void saveWorkspace(nextWorkspace);
    };
    reader.onerror = () => {
      setSelectedLogoName(null);
      setErrorMessage("Unable to read that image. Try another file.");
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteWorkspace = async () => {
    setDeleting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/workspaces/current", {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        redirectTo?: string;
      } | null;

      if (!response.ok || !data?.redirectTo) {
        setErrorMessage(data?.error ?? "Unable to delete workspace.");
        return;
      }

      setDeleteDialogOpen(false);
      router.push(data.redirectTo);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-[600px]">
      <h1 className="mb-6 text-[20px] font-semibold text-[var(--color-text-primary)]">
        Workspace
      </h1>

      {/* Logo */}
      <div className="mb-6">
        <span className="mb-2 block text-[13px] text-[var(--color-text-secondary)]">
          Logo
        </span>
        <div className="flex items-center gap-4">
          <Avatar
            name={workspace.name || "W"}
            src={workspace.logo ?? undefined}
            size="lg"
          />
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={handleLogoSelection}
              aria-label="Upload workspace logo"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Upload logo
            </button>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
              Recommended size: 256x256px
            </p>
            {selectedLogoName ? (
              <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                Selected: {selectedLogoName}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="mb-4">
        <label
          htmlFor="ws-name"
          className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
        >
          Name
        </label>
        <input
          id="ws-name"
          type="text"
          value={workspace.name}
          onChange={(e) => setWorkspace({ ...workspace, name: e.target.value })}
          onBlur={handleFieldBlur}
          className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          aria-label="Workspace name"
        />
      </div>

      {/* URL */}
      <div className="mb-4">
        <label
          htmlFor="ws-url"
          className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
        >
          URL
        </label>
        <div className="flex items-center gap-0">
          <span className="rounded-l-md border border-r-0 border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-tertiary)]">
            linear.app/
          </span>
          <input
            id="ws-url"
            type="text"
            value={workspace.urlSlug}
            onChange={(e) => {
              const nextSlug = e.target.value;
              setWorkspace({ ...workspace, urlSlug: nextSlug });
              setSlugError(validateWorkspaceSlug(nextSlug));
            }}
            onBlur={handleFieldBlur}
            className="w-full rounded-r-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            aria-label="Workspace URL slug"
          />
        </div>
        {slugError ? (
          <p className="mt-1 text-[12px] text-red-400" role="alert">
            {slugError}
          </p>
        ) : null}
      </div>

      {/* Time & region */}
      <SectionHeader title="Time & region" />

      <div className="mb-4 flex items-center justify-between py-2">
        <span className="text-[13px] text-[var(--color-text-primary)]">
          First month of fiscal year
        </span>
        <select
          value={workspace.fiscalMonth}
          onChange={(e) => {
            const nextWorkspace = {
              ...workspace,
              fiscalMonth: e.target.value,
            };
            setWorkspace(nextWorkspace);
            void saveWorkspace(nextWorkspace);
          }}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-2.5 py-1 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          aria-label="First month of fiscal year"
        >
          <option value="january">January</option>
          <option value="february">February</option>
          <option value="march">March</option>
          <option value="april">April</option>
          <option value="july">July</option>
          <option value="october">October</option>
        </select>
      </div>

      <div className="flex items-center justify-between py-2">
        <span className="text-[13px] text-[var(--color-text-primary)]">
          Region
        </span>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">
          {workspace.region}
        </span>
      </div>

      {/* Welcome message */}
      <SectionHeader title="Welcome message" />
      <div className="py-2">
        <button
          type="button"
          onClick={handleWelcomeConfigure}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Configure
        </button>
        <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
          {workspace.welcomeMessage || "No welcome message configured."}
        </p>
      </div>

      {statusMessage ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          {saving ? "Saving workspace changes..." : statusMessage}
        </p>
      ) : null}
      {saving && !statusMessage ? (
        <p className="mt-4 text-[12px] text-[var(--color-text-secondary)]">
          Saving workspace changes...
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-4 text-[12px] text-red-400">{errorMessage}</p>
      ) : null}

      {/* Danger zone */}
      <SectionHeader title="Danger zone" />
      <div className="py-2">
        <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
          Deleting a workspace will permanently remove all its data. This action
          cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setDeleteDialogOpen(true)}
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-red-500/10"
        >
          Delete workspace
        </button>
      </div>

      {welcomeDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            aria-modal="true"
            aria-labelledby="welcome-message-title"
            open
            className="w-full max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl"
          >
            <h2
              id="welcome-message-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Configure welcome message
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              This message appears during workspace onboarding.
            </p>
            <label
              htmlFor="workspace-welcome-message"
              className="mt-4 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Welcome message
            </label>
            <textarea
              id="workspace-welcome-message"
              value={welcomeDraft}
              onChange={(event) => setWelcomeDraft(event.target.value)}
              maxLength={2000}
              rows={6}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              aria-label="Welcome message text"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWelcomeDialogOpen(false)}
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleWelcomeSave}
                disabled={saving}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-accent)] px-3 py-1.5 text-[12px] text-white transition-colors hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}

      {deleteDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            aria-modal="true"
            aria-labelledby="delete-workspace-title"
            open
            className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl"
          >
            <h2
              id="delete-workspace-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Delete workspace?
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Type <strong>{workspace.name}</strong> to confirm. This
              permanently removes the workspace and all of its data.
            </p>
            <label
              htmlFor="delete-workspace-confirmation"
              className="mt-4 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Confirm workspace name
            </label>
            <input
              id="delete-workspace-confirmation"
              type="text"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-red-400"
              aria-label="Confirm workspace name"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setDeleteConfirmation("");
                }}
                disabled={deleting}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                disabled={
                  deleting || deleteConfirmation.trim() !== workspace.name
                }
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete workspace"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
