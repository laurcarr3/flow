import type { Job } from "./job.js";

export const prBody = (j: Job): string =>
  `## Scope\n${j.evidence?.summary}\n\nApproved feature: ${j.featureId}\nContent hash: ${j.approvedHash}\nFlow job: ${j.id}\n\n## Acceptance evidence\n${j.evidence?.acceptance.map((a) => `- ${a.criterion}: ${a.evidence}`).join("\n")}\n\n## Review\n${j.reviews.at(-1)!.result.summary}\n\n## Validation\nCandidate tree: ${j.candidate}\n${j.validations
    .filter((v) => v.revision === j.candidate && !v.invalidated)
    .map((v) => `- ${v.name}: exit ${v.code}`)
    .join("\n")}\n`;
