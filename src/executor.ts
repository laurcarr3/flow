import { z } from "zod";

export const evidenceSchema = z
  .object({
    summary: z.string().min(1),
    acceptance: z
      .array(
        z
          .object({ criterion: z.string().min(1), evidence: z.string().min(1) })
          .strict(),
      )
      .min(1),
    validation: z.array(z.string()),
    responses: z.array(z.string()).default([]),
  })
  .strict();
export const reviewSchema = z
  .object({
    verdict: z.enum(["pass", "changes_required"]),
    findings: z.array(
      z
        .object({ description: z.string().min(1), evidence: z.string().min(1) })
        .strict(),
    ),
    unmetAcceptanceCriteria: z.array(z.string()),
    summary: z.string().min(1),
  })
  .strict()
  .refine(
    (r) =>
      r.verdict !== "pass" ||
      (!r.findings.length && !r.unmetAcceptanceCriteria.length),
    "Passing review cannot have unresolved findings",
  );
export type Evidence = z.infer<typeof evidenceSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Handle = { threadId: string; runId?: string | null };
export type Thread = {
  handle: Handle;
  status: string;
  workspace: string | null;
  branch: string | null;
  pending: boolean;
  result?: string;
};
export type Launch = {
  title: string;
  prompt: string;
  workspace:
    | {
        type: "worktree";
        baseRef: string;
        branch: string;
        startFromOrigin: false;
      }
    | { type: "existing_worktree"; worktreePath: string; branch: string }
    | { type: "root" };
};
export interface Executor {
  check(root: string): Promise<{ projectId: string } | void>;
  find(title: string): Promise<Handle[]>;
  launch(input: Launch): Promise<Handle>;
  send(handle: Handle, prompt: string, key: string): Promise<Handle>;
  read(handle: Handle): Promise<Thread>;
  link(handle: Handle, url: string): Promise<void>;
  close(): Promise<void>;
}
export const resultJson = (text: string): unknown => {
  const trimmed = text.trim();
  return JSON.parse(
    trimmed.replace(/^```(?:json)?\s*\n/, "").replace(/\n```$/, ""),
  );
};
export const threadLink = (h: Handle) => `t3-thread://v1/${h.threadId}`;
export const evidenceFormat =
  '{"summary":"...","acceptance":[{"criterion":"exact acceptance criterion","evidence":"file/test and observed behavior"}],"validation":["commands/results"],"responses":["response to each prior finding"]}';
export const reviewFormat =
  '{"verdict":"pass|changes_required","findings":[{"description":"actionable issue","evidence":"file:line and reproduction"}],"unmetAcceptanceCriteria":["..."],"summary":"..."}';
