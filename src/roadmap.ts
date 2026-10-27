import { threadLink } from "./executor.js";
import {
  contentErrors,
  graphErrors,
  questions,
  type Feature,
} from "./features/documents.js";
import { Git } from "./git.js";
import { Store } from "./state-store.js";
import { dependencyBlockers } from "./workflow/dependencies.js";

export const roadmap = async (
  features: Feature[],
  store: Store,
  git: Git,
  root: string,
) => {
  const errors = graphErrors(features).sort();
  return {
    version: 1,
    graphErrors: errors,
    features: await Promise.all(
      [...features]
        .sort((a, b) => a.id.localeCompare(b.id, "en"))
        .map(async (f) => {
          const j = store.latest(f.id),
            review = j?.reviews.at(-1);
          const validations = new Map(
            j?.validations.map((v) => [v.name, v]) ?? [],
          );
          return {
            id: f.id,
            title: f.title,
            group: f.group ?? null,
            dependsOn: [...f.depends_on].sort(),
            document: {
              status: f.status,
              valid: !contentErrors(f).length,
              approvalMatches: store.approval(f.id) === f.hash,
              hasOpenQuestions: !!questions(f),
            },
            execution: j
              ? {
                  stage: j.stage,
                  outcome: j.outcome,
                  revisions: j.revision,
                  scopeMatchesDocument: j.approvedHash === f.hash,
                }
              : null,
            dependencyBlockers: await dependencyBlockers(f, store, git, root),
            review: review
              ? {
                  verdict: review.result.verdict,
                  findings: review.result.findings.length,
                  unmetAcceptanceCriteria:
                    review.result.unmetAcceptanceCriteria.length,
                  matchesCandidate: review.candidate === j?.candidate,
                }
              : null,
            validation: [...validations]
              .sort(([a], [b]) => a.localeCompare(b, "en"))
              .map(([name, v]) => ({
                name,
                exitCode: v.code,
                matchesCandidate: v.revision === j?.candidate && !v.invalidated,
              })),
            threads: [
              ...new Set(
                j?.operations.flatMap((o) =>
                  o.handle ? [threadLink(o.handle)] : [],
                ) ?? [],
              ),
            ].sort(),
            prUrl: j?.publication.url ?? null,
            delivery: j?.publication.url
              ? await git
                  .prState(j.publication.url, root)
                  .then((s) =>
                    s === "MERGED"
                      ? "delivered"
                      : s === "CLOSED"
                        ? "closed"
                        : "pr_open",
                  )
                  .catch(() => "unknown")
              : "not_delivered",
          };
        }),
    ),
  };
};
