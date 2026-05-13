const controlGroups = [
  {
    title: "Workspace initiatives",
    description:
      "Enable teams to group projects under shared, company-level goals and track progress across your workspace.",
    status: "Enabled",
  },
  {
    title: "Project rollups",
    description:
      "Initiative progress is calculated from linked projects so leadership views stay aligned with team execution.",
    status: "On by default",
  },
  {
    title: "Workspace visibility",
    description:
      "Initiatives are visible to members who can access the associated projects in this workspace.",
    status: "Inherited",
  },
];

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-0.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
      {children}
    </span>
  );
}

function SettingsCard({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: string;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
          {title}
        </h3>
        <p className="mt-1 max-w-[560px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
      <StatusPill>{status}</StatusPill>
    </div>
  );
}

export default function InitiativesSettingsPage() {
  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Initiatives
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-[var(--color-text-secondary)]">
        Configure workspace initiatives, Linear&apos;s way to organize projects
        into strategic goals and track their progress across teams.
      </p>

      <section className="mt-8 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            Feature settings
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            Initiatives are available for this workspace. Settings shown here
            mirror the read-only workspace feature surface until server-side
            initiative preferences are introduced.
          </p>
        </div>
        {controlGroups.map((group) => (
          <SettingsCard key={group.title} {...group} />
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          How initiatives work
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
          Create initiatives from the main Initiatives area, link projects to
          them, and use status rollups to review progress. Workspace-level
          controls on this page are intentionally read-only in the clone so the
          navigation route is complete without exposing non-persistent toggles.
        </p>
      </section>
    </div>
  );
}
