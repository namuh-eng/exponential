"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useRef, useState } from "react";

interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  projectCount: number;
}

const LABEL_COLORS = [
  "#e5484d",
  "#e54666",
  "#f76b15",
  "#f5a623",
  "#f2c94c",
  "#4cb782",
  "#3b82f6",
  "#7180ff",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#6b6f76",
];

function ProjectLabelModal({
  label,
  onClose,
  onSubmit,
}: {
  label?: ProjectLabel | null;
  onClose: () => void;
  onSubmit: (payload: {
    id?: string;
    name: string;
    color: string;
    description: string;
  }) => void;
}) {
  const [name, setName] = useState(label?.name ?? "");
  const [description, setDescription] = useState(label?.description ?? "");
  const [color, setColor] = useState(label?.color ?? LABEL_COLORS[0]);
  const nameRef = useRef<HTMLInputElement>(null);
  const isEditing = Boolean(label);

  useEffect(() => {
    nameRef.current?.focus();
    if (isEditing) {
      nameRef.current?.select();
    }
  }, [isEditing]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    onSubmit({
      id: label?.id,
      name: name.trim(),
      color,
      description: description.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-2xl">
        <h2 className="mb-4 text-[16px] font-semibold text-[var(--color-text-primary)]">
          {isEditing ? "Edit project label" : "Create project label"}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="project-label-name"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Name
            </label>
            <input
              ref={nameRef}
              id="project-label-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Project label name"
            />
          </div>
          <div className="mb-4">
            <label
              htmlFor="project-label-description"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Description
            </label>
            <input
              id="project-label-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Add project label description..."
            />
          </div>
          <div className="mb-6">
            <span className="mb-2 block text-[12px] text-[var(--color-text-secondary)]">
              Color
            </span>
            <div className="flex flex-wrap gap-2">
              {LABEL_COLORS.map((candidateColor) => (
                <button
                  key={candidateColor}
                  type="button"
                  onClick={() => setColor(candidateColor)}
                  className={`h-6 w-6 rounded-full border-2 transition-all ${
                    color === candidateColor
                      ? "scale-110 border-white"
                      : "border-transparent hover:border-[var(--color-border)]"
                  }`}
                  style={{ backgroundColor: candidateColor }}
                  aria-label={`Color ${candidateColor}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isEditing ? "Save changes" : "Create label"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteProjectLabelDialog({
  label,
  onCancel,
  onConfirm,
}: {
  label: ProjectLabel;
  onCancel: () => void;
  onConfirm: (label: ProjectLabel) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-[420px] rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-project-label-title"
        aria-describedby="delete-project-label-description"
      >
        <h2
          id="delete-project-label-title"
          className="text-[16px] font-semibold text-[var(--color-text-primary)]"
        >
          Delete project label?
        </h2>
        <p
          id="delete-project-label-description"
          className="mt-3 text-[13px] leading-5 text-[var(--color-text-secondary)]"
        >
          Delete the project label "{label.name}"? This will remove it from all
          projects currently using it and from project filters and selectors.
        </p>
        {label.projectCount > 0 && (
          <p className="mt-3 text-[13px] text-[var(--color-text-tertiary)]">
            Currently used by {label.projectCount}{" "}
            {label.projectCount === 1 ? "project" : "projects"}.
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(label)}
            className="rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Delete label
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectLabelsPage() {
  const [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState<ProjectLabel[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLabel, setEditingLabel] = useState<ProjectLabel | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<ProjectLabel | null>(null);

  const fetchLabels = useCallback(() => {
    setErrorMessage(null);
    fetch("/api/project-labels")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load labels");
        }
        const data = await res.json();
        return data.labels as ProjectLabel[];
      })
      .then((data) => {
        setLabels(data ?? []);
      })
      .catch(() => {
        setLabels([]);
        setErrorMessage("Unable to load project labels.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const handleCreate = async ({
    name,
    color,
    description,
  }: {
    name: string;
    color: string;
    description: string;
  }) => {
    const res = await fetch("/api/project-labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, description }),
    });

    if (!res.ok) {
      setErrorMessage("Unable to create project label.");
      return;
    }

    setShowCreateModal(false);
    fetchLabels();
  };

  const handleEdit = async ({
    id,
    name,
    color,
    description,
  }: {
    id?: string;
    name: string;
    color: string;
    description: string;
  }) => {
    if (!id) {
      return;
    }

    const res = await fetch(`/api/project-labels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, description }),
    });

    if (!res.ok) {
      setErrorMessage("Unable to update project label.");
      return;
    }

    setLabels((currentLabels) =>
      currentLabels.map((label) =>
        label.id === id
          ? { ...label, name, color, description: description || null }
          : label,
      ),
    );
    setEditingLabel(null);
  };

  const handleDelete = async (label: ProjectLabel) => {
    setErrorMessage(null);
    const res = await fetch(`/api/project-labels/${label.id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      let detail = "";
      try {
        const payload = await res.json();
        detail = typeof payload.error === "string" ? ` ${payload.error}` : "";
      } catch {
        // Keep the generic error if the API did not return JSON.
      }
      setErrorMessage(`Unable to delete project label.${detail}`);
      return;
    }

    setLabels((currentLabels) =>
      currentLabels.filter((currentLabel) => currentLabel.id !== label.id),
    );
    setDeletingLabel(null);
    if (editingLabel?.id === label.id) {
      setEditingLabel(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          Project labels
        </h1>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Create label
        </button>
      </div>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Create and manage labels specifically for projects to help with
        categorization and reporting.
      </p>

      {errorMessage && (
        <p className="mt-4 text-[13px] text-red-400">{errorMessage}</p>
      )}

      <div className="mt-8">
        {labels.length === 0 ? (
          <EmptyState
            title="No project labels"
            description="Create your first project label to start categorizing your roadmap."
            action={{
              label: "Create project label",
              onClick: () => setShowCreateModal(true),
            }}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {labels.map((label) => (
              <div
                key={label.id}
                className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <div>
                    <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                      {label.name}
                    </div>
                    {label.description && (
                      <div className="text-[12px] text-[var(--color-text-tertiary)]">
                        {label.description}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">
                    {label.projectCount}{" "}
                    {label.projectCount === 1 ? "project" : "projects"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDeletingLabel(label)}
                    className="text-[13px] text-red-400 hover:text-red-300"
                    aria-label={`Delete ${label.name}`}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingLabel(label)}
                    className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    aria-label={`Edit ${label.name}`}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <ProjectLabelModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
        />
      )}
      {editingLabel && (
        <ProjectLabelModal
          label={editingLabel}
          onClose={() => setEditingLabel(null)}
          onSubmit={handleEdit}
        />
      )}
      {deletingLabel && (
        <DeleteProjectLabelDialog
          label={deletingLabel}
          onCancel={() => setDeletingLabel(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
