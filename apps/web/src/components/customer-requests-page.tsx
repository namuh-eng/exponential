"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface CustomerSummary {
  id: string;
  name: string;
  domain: string | null;
  revenue: number | null;
  size: number | null;
  tier: string | null;
  status: string | null;
  ownerId: string | null;
  source: string | null;
  requestCount: number;
  issueCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerRequestItem {
  id: string;
  customerId: string;
  customer: { id: string; name: string; domain: string | null };
  title: string;
  body: string | null;
  important: boolean;
  source: string | null;
  sourceUrl: string | null;
  linkedIssues: {
    id: string;
    identifier: string;
    title: string;
    teamKey: string;
  }[];
  linkedProjects: { id: string; slug: string; name: string }[];
  createdAt: string;
}

interface CustomerDetailResponse {
  customer: CustomerSummary;
  requests: CustomerRequestItem[];
  issues: { id: string; identifier: string; title: string; teamKey: string }[];
  projects: { id: string; slug: string; name: string }[];
}

function customerPath(path: string, workspaceSlug: string | undefined) {
  return withWorkspaceSlug(path, workspaceSlug ?? "");
}

function fieldValue(value: string | number | null) {
  if (value === null || value === "") return "—";
  return value;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CustomersPage() {
  const shell = useAppShellContext();
  const workspaceSlug = shell?.workspaceSlug;
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/customers");
      if (!res.ok) {
        throw new Error("Couldn’t load customers");
      }
      const json = (await res.json()) as { customers?: CustomerSummary[] };
      setCustomers(json.customers ?? []);
    } catch (err) {
      setCustomers([]);
      setError(err instanceof Error ? err.message : "Couldn’t load customers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          domain: domain || null,
          tier: tier || null,
          status: status || null,
          source: "manual",
        }),
      });
      if (!res.ok) {
        throw new Error("Create customer failed");
      }
      const created = (await res.json()) as CustomerSummary;
      setCustomers((current) => [created, ...current]);
      setName("");
      setDomain("");
      setTier("");
      setStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create customer failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header>
        <p className="editorial-section-title text-[12px] text-[var(--color-text-tertiary)]">
          Customer requests
        </p>
        <h1 className="mt-2 text-[28px] font-semibold text-[var(--color-text-primary)]">
          Customers
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--color-text-secondary)]">
          Track customer attributes, connect feedback to issues and projects,
          and export request context for account reviews.
        </p>
      </header>

      <form
        onSubmit={createCustomer}
        className="tty-panel grid gap-3 p-4 md:grid-cols-5"
      >
        <label className="md:col-span-2 text-[12px] text-[var(--color-text-secondary)]">
          Name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
          />
        </label>
        <label className="text-[12px] text-[var(--color-text-secondary)]">
          Domain
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="acme.com"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
          />
        </label>
        <label className="text-[12px] text-[var(--color-text-secondary)]">
          Tier
          <input
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            placeholder="enterprise"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
          />
        </label>
        <label className="text-[12px] text-[var(--color-text-secondary)]">
          Status
          <input
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="active"
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[14px] text-[var(--color-text-primary)]"
          />
        </label>
        <div className="md:col-span-5 flex items-center justify-between gap-3">
          {error ? (
            <p className="text-[13px] text-red-500">{error}</p>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="tty-button-primary px-3 py-2 text-[13px] disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create customer"}
          </button>
        </div>
      </form>

      <section className="tty-panel overflow-hidden">
        <div className="tty-status-bar justify-between border-b px-3 py-2">
          <h2 className="editorial-section-title text-[12px] text-[var(--color-text-primary)]">
            Customer index
          </h2>
          <span className="text-[12px] text-[var(--color-text-tertiary)]">
            {customers.length} customers
          </span>
        </div>
        {loading ? (
          <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            Loading customers…
          </p>
        ) : customers.length === 0 ? (
          <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
            No customers yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {customers.map((customer) => (
              <Link
                key={customer.id}
                href={customerPath(`/customers/${customer.id}`, workspaceSlug)}
                className="tty-row grid gap-3 px-4 py-3 text-[13px] hover:bg-[var(--color-surface-hover)] md:grid-cols-[1.4fr_1fr_0.6fr_0.6fr_0.8fr]"
              >
                <span className="font-medium text-[var(--color-text-primary)]">
                  {customer.name}
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {fieldValue(customer.domain)}
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {fieldValue(customer.tier)}
                </span>
                <span className="text-[var(--color-text-secondary)]">
                  {fieldValue(customer.status)}
                </span>
                <span className="text-[var(--color-text-tertiary)]">
                  {customer.requestCount} requests · {customer.issueCount}{" "}
                  issues · {customer.projectCount} projects
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export function CustomerDetailPage() {
  const params = useParams<{ customerId: string; workspaceSlug?: string }>();
  const shell = useAppShellContext();
  const workspaceSlug = params.workspaceSlug ?? shell?.workspaceSlug;
  const [data, setData] = useState<CustomerDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const exportHref = useMemo(
    () =>
      `/api/customers/${encodeURIComponent(params.customerId)}/requests.csv`,
    [params.customerId],
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/customers/${encodeURIComponent(params.customerId)}`,
        );
        if (!res.ok) throw new Error("Couldn’t load customer");
        setData((await res.json()) as CustomerDetailResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t load customer");
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [params.customerId]);

  if (loading) {
    return (
      <main className="p-6 text-[14px] text-[var(--color-text-secondary)]">
        Loading customer…
      </main>
    );
  }

  if (!data) {
    return (
      <main className="p-6 text-[14px] text-red-500">
        {error ?? "Customer not found"}
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[1fr_320px]">
      <section className="space-y-6">
        <header>
          <Link
            href={customerPath("/customers", workspaceSlug)}
            className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            ← Customers
          </Link>
          <h1 className="mt-2 text-[28px] font-semibold text-[var(--color-text-primary)]">
            {data.customer.name}
          </h1>
          <p className="mt-2 text-[14px] text-[var(--color-text-secondary)]">
            {fieldValue(data.customer.domain)} ·{" "}
            {fieldValue(data.customer.tier)} ·{" "}
            {fieldValue(data.customer.status)}
          </p>
        </header>

        <section className="tty-panel overflow-hidden">
          <div className="tty-status-bar justify-between border-b px-3 py-2">
            <h2 className="editorial-section-title text-[12px] text-[var(--color-text-primary)]">
              Requests
            </h2>
            <a
              href={exportHref}
              className="text-[12px] text-[var(--color-accent)] hover:underline"
            >
              Export CSV
            </a>
          </div>
          {data.requests.length === 0 ? (
            <p className="p-4 text-[13px] text-[var(--color-text-secondary)]">
              No requests yet.
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              {data.requests.map((request) => (
                <article key={request.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                        {request.important ? "★ " : ""}
                        {request.title}
                      </h3>
                      {request.body ? (
                        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                          {request.body}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      {formatDate(request.createdAt)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--color-text-tertiary)]">
                    {request.linkedIssues.map((issue) => (
                      <Link
                        key={issue.id}
                        href={customerPath(
                          `/issue/${issue.identifier}`,
                          workspaceSlug,
                        )}
                        className="tty-row border border-[var(--color-border)] px-2 py-1 hover:text-[var(--color-text-primary)]"
                      >
                        {issue.identifier}
                      </Link>
                    ))}
                    {request.linkedProjects.map((project) => (
                      <Link
                        key={project.id}
                        href={customerPath(
                          `/project/${project.slug}`,
                          workspaceSlug,
                        )}
                        className="tty-row border border-[var(--color-border)] px-2 py-1 hover:text-[var(--color-text-primary)]"
                      >
                        {project.name}
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <aside className="tty-panel h-fit p-4">
        <h2 className="editorial-section-title text-[12px] text-[var(--color-text-tertiary)]">
          Attributes
        </h2>
        <dl className="mt-4 space-y-3 text-[13px]">
          {[
            ["Domain", data.customer.domain],
            ["Revenue", data.customer.revenue],
            ["Size", data.customer.size],
            ["Tier", data.customer.tier],
            ["Status", data.customer.status],
            ["Source", data.customer.source],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
              <dd className="text-right text-[var(--color-text-primary)]">
                {fieldValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </aside>
    </main>
  );
}
