"use client";

import { Avatar } from "@/components/avatar";
import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

interface ProfileData {
  name: string;
  email: string;
  username: string;
  image: string | null;
  pronouns: string;
  title: string;
  location: string;
  timezone: string;
  showLocalTime: boolean;
}

interface WorkspaceAccess {
  currentWorkspaceId: string | null;
  currentWorkspaceName: string | null;
}

const apiClient = createBrowserApiClient();

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData>({
    name: "",
    email: "",
    username: "",
    image: null,
    pronouns: "",
    title: "",
    location: "",
    timezone: "",
    showLocalTime: false,
  });
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccess>({
    currentWorkspaceId: null,
    currentWorkspaceName: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leavingWorkspace, setLeavingWorkspace] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPhotoName, setSelectedPhotoName] = useState<string | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiClient
      .GET("/account/profile")
      .then(({ data }) => {
        if (data?.profile) {
          setProfile({
            name: data.profile.name ?? "",
            email: data.profile.email ?? "",
            username: data.profile.username ?? "",
            image: data.profile.image ?? null,
            pronouns: data.profile.pronouns ?? "",
            title: data.profile.title ?? "",
            location: data.profile.location ?? "",
            timezone: data.profile.timezone ?? "",
            showLocalTime: data.profile.showLocalTime ?? false,
          });
          setWorkspaceAccess({
            currentWorkspaceId:
              data.workspaceAccess?.currentWorkspaceId ?? null,
            currentWorkspaceName:
              data.workspaceAccess?.currentWorkspaceName ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePhotoSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setStatusMessage(null);
    setErrorMessage(null);
    setSelectedPhotoName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      setProfile((currentProfile) => ({
        ...currentProfile,
        image: typeof reader.result === "string" ? reader.result : null,
      }));
    };
    reader.onerror = () => {
      setSelectedPhotoName(null);
      setErrorMessage("Unable to read that image. Try another file.");
    };
    reader.readAsDataURL(file);
  };

  const handleUpdate = async () => {
    setStatusMessage(null);
    setErrorMessage(null);
    setSaving(true);

    try {
      const { data, error } = await apiClient.PATCH("/account/profile", {
        body: {
          name: profile.name,
          username: profile.username,
          image: profile.image,
          pronouns: profile.pronouns,
          title: profile.title,
          location: profile.location,
          timezone: profile.timezone,
          showLocalTime: profile.showLocalTime,
        },
      });

      if (error || !data?.profile) {
        setErrorMessage(
          apiErrorMessage(error, "Unable to update your profile."),
        );
        return;
      }

      setProfile({ ...data.profile, image: data.profile.image ?? null });
      setSelectedPhotoName(null);
      setStatusMessage("Profile updated.");
    } finally {
      setSaving(false);
    }
  };

  const handleLeaveWorkspace = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setLeavingWorkspace(true);

    try {
      const { data, error } = await apiClient.DELETE(
        "/account/profile/workspace",
      );

      if (error || !data?.redirectTo) {
        setErrorMessage(
          apiErrorMessage(error, "Unable to leave the workspace."),
        );
        return;
      }

      setLeaveDialogOpen(false);
      router.push(data.redirectTo);
      router.refresh();
    } finally {
      setLeavingWorkspace(false);
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
        Profile
      </h1>

      {/* Profile picture */}
      <div className="mb-6">
        <span className="mb-2 block text-[13px] text-[var(--color-text-secondary)]">
          Profile picture
        </span>
        <div className="flex items-center gap-4">
          <Avatar
            name={profile.name || "U"}
            src={profile.image ?? undefined}
            size="lg"
          />
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={handlePhotoSelection}
              aria-label="Upload profile picture"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Upload photo
            </button>
            <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
              Recommended size: 256x256px
            </p>
            {selectedPhotoName ? (
              <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                Selected: {selectedPhotoName}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Email (read-only) */}
      <div className="mb-4">
        <label
          htmlFor="profile-email"
          className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
        >
          Email
        </label>
        <input
          id="profile-email"
          type="email"
          value={profile.email}
          readOnly
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-1.5 text-[13px] text-[var(--color-text-tertiary)] outline-none"
          aria-label="Email"
        />
      </div>

      {/* Full name */}
      <div className="mb-4">
        <label
          htmlFor="profile-name"
          className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
        >
          Full name
        </label>
        <input
          id="profile-name"
          type="text"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          aria-label="Full name"
        />
      </div>

      {/* Username */}
      <div className="mb-6">
        <label
          htmlFor="profile-username"
          className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
        >
          Username
        </label>
        <input
          id="profile-username"
          type="text"
          value={profile.username}
          onChange={(e) => setProfile({ ...profile, username: e.target.value })}
          className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          placeholder="One word, like a nickname or first name"
          aria-label="Username"
        />
      </div>

      {/* Profile metadata */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="profile-pronouns"
            className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
          >
            Pronouns
          </label>
          <input
            id="profile-pronouns"
            type="text"
            value={profile.pronouns}
            onChange={(e) =>
              setProfile({ ...profile, pronouns: e.target.value })
            }
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="They/them"
            aria-label="Pronouns"
          />
        </div>
        <div>
          <label
            htmlFor="profile-title"
            className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
          >
            Role or title
          </label>
          <input
            id="profile-title"
            type="text"
            value={profile.title}
            onChange={(e) => setProfile({ ...profile, title: e.target.value })}
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="Product Engineer"
            aria-label="Role or title"
          />
        </div>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="profile-location"
            className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
          >
            Location
          </label>
          <input
            id="profile-location"
            type="text"
            value={profile.location}
            onChange={(e) =>
              setProfile({ ...profile, location: e.target.value })
            }
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="San Francisco"
            aria-label="Location"
          />
        </div>
        <div>
          <label
            htmlFor="profile-timezone"
            className="mb-1.5 block text-[13px] text-[var(--color-text-secondary)]"
          >
            Timezone
          </label>
          <input
            id="profile-timezone"
            type="text"
            value={profile.timezone}
            onChange={(e) =>
              setProfile({ ...profile, timezone: e.target.value })
            }
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder="America/Los_Angeles"
            aria-label="Timezone"
          />
          <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={profile.showLocalTime}
              onChange={(e) =>
                setProfile({ ...profile, showLocalTime: e.target.checked })
              }
              className="h-3.5 w-3.5 rounded border-[var(--color-border)]"
            />
            Show my local time on profile surfaces
          </label>
        </div>
      </div>

      {/* Update button */}
      <button
        type="button"
        onClick={handleUpdate}
        disabled={saving}
        className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Updating..." : "Update"}
      </button>
      {statusMessage ? (
        <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
          {statusMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-3 text-[12px] text-red-400">{errorMessage}</p>
      ) : null}

      {/* Workspace access */}
      <div className="mt-10 border-t border-[var(--color-border)] pt-6">
        <h3 className="mb-2 text-[13px] font-medium text-[var(--color-text-primary)]">
          Workspace access
        </h3>
        <p className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">
          {workspaceAccess.currentWorkspaceName
            ? `Remove yourself from ${workspaceAccess.currentWorkspaceName}.`
            : "Remove yourself from the active workspace."}
        </p>
        <button
          type="button"
          onClick={() => setLeaveDialogOpen(true)}
          disabled={!workspaceAccess.currentWorkspaceId || leavingWorkspace}
          className="rounded-md border border-red-500/30 px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-red-500/10"
        >
          Leave workspace
        </button>
      </div>

      {leaveDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            aria-modal="true"
            aria-labelledby="leave-workspace-title"
            open
            className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 shadow-2xl"
          >
            <h2
              id="leave-workspace-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Leave workspace?
            </h2>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              {workspaceAccess.currentWorkspaceName
                ? `You will lose access to ${workspaceAccess.currentWorkspaceName} until someone invites you back.`
                : "You will lose access to this workspace until someone invites you back."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLeaveDialogOpen(false)}
                disabled={leavingWorkspace}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLeaveWorkspace}
                disabled={leavingWorkspace}
                className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-50"
              >
                {leavingWorkspace ? "Leaving..." : "Leave workspace"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
