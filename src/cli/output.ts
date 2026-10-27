import { threadLink } from "../executor.js";
import type { roadmap } from "../roadmap.js";
import type { Job } from "../workflow/job.js";

type RoadmapFeature = Awaited<ReturnType<typeof roadmap>>["features"][number];

export const formatJobHeading = (job: Job): string =>
  `${job.featureId}: ${job.stage} (${job.outcome})`;

export const formatJobDetails = (job: Job): string[] => {
  const lines: string[] = [];
  if (job.workspace) lines.push(`Workspace: ${job.workspace}`);
  const handle = job.operations.at(-1)?.handle ?? job.implementation;
  if (handle) lines.push(threadLink(handle));
  if (job.publication.url) lines.push(job.publication.url);
  return lines;
};

export const formatFeatureStatus = (
  f: RoadmapFeature,
  error?: string,
): string => {
  const lines: string[] = [];

  lines.push(
    `\n${f.title} (${f.id})\n  Document: ${f.document.status}; ${f.document.approvalMatches ? "approved" : "approval required"}`,
  );
  lines.push(
    `  Execution: ${f.execution ? `${f.execution.stage} (${f.execution.outcome})` : "not started"}; delivery: ${f.delivery}`,
  );
  for (const blocker of f.dependencyBlockers)
    lines.push(`  Blocked: ${blocker}`);
  if (f.review)
    lines.push(`  Review: ${f.review.verdict}; ${f.review.findings} findings`);
  for (const v of f.validation)
    lines.push(
      `  Validation ${v.name}: exit ${v.exitCode}${v.matchesCandidate ? "" : " (stale)"}`,
    );
  if (error) lines.push(`  Attention: ${error}`);
  for (const link of f.threads) lines.push(`  ${link}`);
  if (f.prUrl) lines.push(`  ${f.prUrl}`);
  lines.push(
    `  Next: ${f.execution && f.execution.stage !== "pr_open" && f.execution.outcome !== "cancelled" ? "Resume" : f.prUrl ? "Review the PR in GitHub" : f.document.approvalMatches ? "Run" : "Edit the document, then Ready"}`,
  );

  return lines.join("\n");
};
