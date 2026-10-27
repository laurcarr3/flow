import { evidenceFormat, reviewFormat } from "../executor.js";
import { acceptanceCriteria, parseFeature } from "../features/documents.js";
import { type Job } from "./job.js";
export const implementationPrompt = (j: Job): string => {
  return `Implement the approved feature below in your T3-bound worktree. Read applicable AGENTS.md and repository instructions first. Scope is frozen to this PRD. Do not create branches/worktrees, push, create PRs, or merge. Do not change features/, flow.config.json, or .flow/. Do not start background work or delegate tasks. Complete the implementation and provide concrete evidence for EVERY acceptance criterion. Ask material questions in T3 when blocked. Required validation commands (argument arrays): ${JSON.stringify(j.config.validation)}. List these exact acceptance criteria in the evidence: ${JSON.stringify(acceptanceCriteria(parseFeature(j.snapshot)))}. Do not claim a pass without evidence. End your final reply with ONLY a JSON object matching ${evidenceFormat}.\n\n${j.snapshot}`;
};

export const reviewPrompt = (j: Job, diff: string): string =>
  `Independently review this candidate against the approved PRD and repository instructions. Read AGENTS.md. You are explicitly bound to the implementation worktree. Do NOT modify files, commit, push, launch agents, or create a PR. Inspect the diff and evidence; identify correctness problems and unmet acceptance criteria. Treat implementation claims as unverified. Return ONLY JSON matching ${reviewFormat}. A pass requires no unresolved findings or unmet criteria. Candidate Git tree: ${j.candidate}.\nPRD:\n${j.snapshot}\nImplementation evidence and responses:\n${JSON.stringify(j.evidence)}\nPrior review history including unresolved objections:\n${JSON.stringify(j.reviews.map((r) => r.result))}\nValidation results:\n${JSON.stringify(j.validations.map((v) => ({ name: v.name, code: v.code, revision: v.revision })))}\nDiff:\n${diff}`;
export const revisionPrompt = (j: Job): string =>
  `${implementationPrompt(j)}\nAddress these independent review findings. Explain every fix and any disagreement in responses.\n${JSON.stringify(j.reviews.map((r) => r.result))}`;
