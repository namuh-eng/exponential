"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { stripWorkspaceSlug, withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  label: string;
  href: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: "Account",
    items: [
      { label: "Preferences", href: "/settings/account/preferences" },
      { label: "Profile", href: "/settings/account/profile" },
      { label: "Notifications", href: "/settings/account/notifications" },
      { label: "Security & access", href: "/settings/account/security" },
      { label: "Connected accounts", href: "/settings/account/connections" },
      { label: "Agent personalization", href: "/settings/account/agents" },
    ],
  },
  {
    title: "Issues",
    items: [
      { label: "Labels", href: "/settings/issue-labels" },
      { label: "Templates", href: "/settings/issue-templates" },
      { label: "SLAs", href: "/settings/sla" },
    ],
  },
  {
    title: "Projects",
    items: [
      { label: "Labels", href: "/settings/project-labels" },
      { label: "Templates", href: "/settings/project-templates" },
      { label: "Statuses", href: "/settings/project-statuses" },
      { label: "Updates", href: "/settings/project-updates" },
    ],
  },
  {
    title: "Features",
    items: [
      { label: "AI & Agents", href: "/settings/ai" },
      { label: "Initiatives", href: "/settings/initiatives" },
      { label: "Documents", href: "/settings/documents" },
      { label: "Customer requests", href: "/settings/customer-requests" },
      { label: "Pulse", href: "/settings/pulse" },
      { label: "Asks", href: "/settings/asks" },
      { label: "Emojis", href: "/settings/emojis" },
      { label: "Integrations", href: "/settings/integrations" },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Workspace", href: "/settings/workspace" },
      { label: "Teams", href: "/settings/teams" },
      { label: "Members", href: "/settings/members" },
      { label: "Security", href: "/settings/security" },
      { label: "API", href: "/settings/api" },
      { label: "Applications", href: "/settings/applications" },
      { label: "Billing", href: "/settings/billing" },
      { label: "Import & export", href: "/settings/import-export" },
    ],
  },
];

function isActiveSettingsPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SettingsSidebarLink({
  href,
  label,
  active,
  workspaceSlug,
}: {
  href: string;
  label: string;
  active: boolean;
  workspaceSlug?: string;
}) {
  return (
    <Link
      href={withWorkspaceSlug(href, workspaceSlug)}
      className={`block rounded-md px-2 py-[5px] text-[13px] transition-colors ${
        active
          ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      }`}
    >
      {label}
    </Link>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mt-4 mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
      {title}
    </div>
  );
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const shellContext = useAppShellContext();
  const workspaceSlug = shellContext?.workspaceSlug;
  const pathname = stripWorkspaceSlug(usePathname(), workspaceSlug);
  const sectionsWithTeams =
    shellContext?.teams && shellContext.teams.length > 0
      ? [
          ...sections,
          {
            title: "Your teams",
            items: shellContext.teams.map((team) => ({
              label: team.name,
              href: `/settings/teams/${encodeURIComponent(team.key)}`,
            })),
          },
        ]
      : sections;

  return (
    <div className="editorial-page-surface flex h-full flex-col md:flex-row">
      {/* Settings sidebar */}
      <aside className="max-h-[40vh] w-full shrink-0 overflow-y-auto border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface)_64%,transparent)] px-3 py-4 md:max-h-none md:w-[220px] md:border-b-0 md:border-r">
        <Link
          href={withWorkspaceSlug("/inbox", workspaceSlug)}
          className="mb-4 flex items-center gap-1.5 px-2 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to app
        </Link>

        <h2 className="mb-2 px-2 text-[15px] font-semibold text-[var(--color-text-primary)]">
          Settings
        </h2>

        <nav>
          {sectionsWithTeams.map((section) => (
            <div key={section.title}>
              <SectionTitle title={section.title} />
              {section.items.map((item) => (
                <SettingsSidebarLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={isActiveSettingsPath(pathname, item.href)}
                  workspaceSlug={workspaceSlug}
                />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content area */}
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
