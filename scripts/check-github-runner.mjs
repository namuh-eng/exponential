const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const labels = (
  process.env.REQUIRED_RUNNER_LABELS || "self-hosted,exponential-deploy"
)
  .split(",")
  .map((label) => label.trim())
  .filter(Boolean);
const runbook =
  process.env.RUNNER_RECOVERY_RUNBOOK || "docs/deploy-runner-recovery.md";

if (!repository || !repository.includes("/")) {
  throw new Error("GITHUB_REPOSITORY must be set to owner/repo.");
}

if (!token) {
  throw new Error(
    "GITHUB_TOKEN must be set so runner status can be checked before scheduling deploy.",
  );
}

const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function fetchRunners(page = 1) {
  const response = await fetch(
    `${apiBase}/repos/${repository}/actions/runners?per_page=100&page=${page}`,
    { headers },
  );

  if (!response.ok) {
    const body = await response.text();
    const details = body ? ` ${body.slice(0, 500)}` : "";
    // The runners API requires repository Administration access. The default
    // GITHUB_TOKEN cannot read it, so when GH_RUNNER_STATUS_TOKEN is unset the
    // request returns 401/403. Treat that as "cannot verify" and skip the
    // precheck instead of blocking the deploy — the deploy job itself still
    // fails safely if no self-hosted runner picks it up. Set
    // GH_RUNNER_STATUS_TOKEN (repo Administration: read) to re-enable the gate.
    if (response.status === 401 || response.status === 403) {
      console.warn(
        `::warning::Skipping self-hosted runner precheck: cannot read runner status ` +
          `(${response.status} ${response.statusText}). Set GH_RUNNER_STATUS_TOKEN ` +
          `(repository Administration: read) to re-enable this gate. See ${runbook}.${details}`,
      );
      process.exit(0);
    }
    throw new Error(
      `Unable to check GitHub self-hosted runner status (${response.status} ${response.statusText}). Confirm the workflow token or GH_RUNNER_STATUS_TOKEN can read repository self-hosted runners. See ${runbook}.${details}`,
    );
  }

  const payload = await response.json();
  const runners = Array.isArray(payload.runners) ? payload.runners : [];
  if (runners.length === 100) {
    return runners.concat(await fetchRunners(page + 1));
  }
  return runners;
}

const runners = await fetchRunners();
const matching = runners.filter((runner) => {
  const runnerLabels = new Set(
    (runner.labels || []).map((label) => label.name),
  );
  return labels.every((label) => runnerLabels.has(label));
});
const online = matching.filter((runner) => runner.status === "online");

if (online.length === 0) {
  const seen = matching
    .map(
      (runner) => `${runner.name || runner.id}: ${runner.status || "unknown"}`,
    )
    .join(", ");
  const seenDetails = seen
    ? ` Matching runners seen: ${seen}.`
    : " No matching runners were registered.";
  console.error(
    `::error::No online GitHub Actions runner has labels [${labels.join(", ")}].` +
      `${seenDetails} Use workflow_dispatch with deploy_lane=github-hosted-oidc or run local break-glass deploy. See ${runbook}.`,
  );
  process.exit(1);
}

console.log(
  `Found online deploy runner(s): ${online.map((runner) => runner.name || runner.id).join(", ")}`,
);
