import { randomUUID } from "node:crypto";
import {
  resultJson,
  reviewSchema,
  threadLink,
  type Executor,
} from "../executor.js";
import { Git } from "../git.js";
import { Store } from "../state-store.js";
import { AgentOperations } from "./agent-operations.js";
import { NeedsInput } from "./errors.js";
import { parseEvidence } from "./evidence.js";
import type { ResumeOptions } from "./job.js";
import { type Job, type Stage } from "./job.js";
import {
  implementationPrompt,
  reviewPrompt,
  revisionPrompt,
} from "./prompts.js";
import { hasPassingValidation } from "./validation.js";
export class Runner {
  private operations: AgentOperations;
  constructor(
    private root: string,
    private store: Store,
    private backend: Executor,
    private git: Git,
  ) {
    this.operations = new AgentOperations(root, store, backend, git);
  }
  private save = (j: Job) => {
    this.store.save(j);
  };
  private stage = (j: Job, stage: Stage) => {
    j.stage = stage;
    j.outcome = "active";
    delete j.error;
    this.save(j);
  };
  advance = async (j: Job, opts: ResumeOptions = {}): Promise<Job> => {
    if (j.stage === "pr_open" || j.outcome === "cancelled") return j;
    try {
      const connection = await this.backend.check(this.root);
      if (connection) {
        j.config.t3.projectId = connection.projectId;
        this.save(j);
      }
      j.outcome = "active";
      delete j.error;
      this.save(j);
      if (j.validationInFlight) {
        if (!opts.retryValidation)
          throw new NeedsInput(
            `Validation ${j.validationInFlight} was interrupted and may still be running. Confirm it has stopped, then resume --retry-validation (and --recheck if files changed).`,
          );
        delete j.validationInFlight;
        this.save(j);
      }
      if (
        opts.recheck &&
        j.workspace &&
        ["reviewing", "validating", "publishing"].includes(j.stage)
      ) {
        if (j.publication.attempted || j.publication.pushed)
          throw new NeedsInput(
            "Publication has started; reconcile GitHub before changing the candidate.",
          );
        for (const op of j.operations.filter(
          (o) => o.handle && o.title.includes(":review:"),
        )) {
          const t = await this.backend.read(op.handle!);
          if (
            ![
              "completed",
              "failed",
              "cancelled",
              "interrupted",
              "rolled_back",
            ].includes(t.status)
          )
            throw new NeedsInput(
              `Finish or stop the existing reviewer before rechecking: ${threadLink(t.handle)}`,
            );
        }
        const implementationOp = j.operations.findLast(
          (o) => o.handle?.threadId === j.implementation?.threadId,
        );
        if (!implementationOp)
          throw new NeedsInput("Missing implementation handle.");
        const implementation = await this.operations.read(
          j,
          implementationOp,
          true,
        );
        if (!implementation)
          throw new NeedsInput(
            "Wait for the implementation thread to finish before rechecking.",
          );
        j.evidence = parseEvidence(j, implementation.result!);
        for (const result of j.validations) result.invalidated = true;
        j.candidate = await this.git.candidate(j.workspace);
        j.publication = {};
        this.stage(j, "reviewing");
        // New review identity, even when retrying malformed output on the same tree.
        j.operations = j.operations.map((o) =>
          o.key.startsWith("review-")
            ? { ...o, key: `archived-${randomUUID()}-${o.key}` }
            : o,
        );
        this.save(j);
      }
      for (let step = 0; step < 20; step++) {
        if (j.workspace) {
          await this.git.binding(this.root, j.workspace, j.branch);
          await this.git.cmd(
            j.workspace,
            "merge-base",
            "--is-ancestor",
            j.base,
            "HEAD",
          );
        }
        if (j.stage === "preparing" || j.stage === "implementing") {
          const op = await this.operations.launch(
            j,
            "implementation",
            {
              title: `flow:${j.id}:implementation`,
              prompt: implementationPrompt(j),
              workspace: {
                type: "worktree",
                baseRef: j.base,
                branch: j.branch,
                startFromOrigin: false,
              },
            },
            opts,
          );
          j.implementation = op.handle;
          this.stage(j, "implementing");
          const t = await this.operations.read(j, op, true);
          if (!t) return j;
          j.evidence = parseEvidence(j, t.result!);
          j.candidate = await this.git.candidate(j.workspace!);
          if (!(await this.git.diff(j.workspace!, j.base)))
            throw new NeedsInput("Implementation produced no diff.");
          this.stage(j, "reviewing");
        } else if (j.stage === "reviewing") {
          const before = await this.git.candidate(j.workspace!);
          if (before !== j.candidate)
            throw new NeedsInput(
              "Candidate changed. Use resume --recheck to obtain a fresh review.",
            );
          const diff = await this.git.diff(j.workspace!, j.base);
          const prompt = reviewPrompt(j, diff);
          const op = await this.operations.launch(
            j,
            `review-${j.revision}-${j.candidate}`,
            {
              title: `flow:${j.id}:review:${j.operations.filter((o) => o.title.includes(":review:")).length}`,
              prompt,
              workspace: {
                type: "existing_worktree",
                worktreePath: j.workspace!,
                branch: j.branch,
              },
            },
            opts,
          );
          if (op.handle!.threadId === j.implementation!.threadId)
            throw new NeedsInput("Review must use an independent thread.");
          const t = await this.operations.read(j, op);
          if (!t) return j;
          if ((await this.git.candidate(j.workspace!)) !== before)
            throw new NeedsInput(
              "Files changed during review; use resume --recheck after inspecting the worktree.",
            );
          const result = reviewSchema.parse(resultJson(t.result!));
          if (
            !j.reviews.some(
              (r) =>
                r.handle.threadId === t.handle.threadId &&
                r.handle.runId === t.handle.runId,
            )
          )
            j.reviews.push({ candidate: before, handle: t.handle, result });
          this.save(j);
          if (result.verdict === "pass") this.stage(j, "validating");
          else {
            if (j.revision >= j.config.maxRevisions)
              throw new NeedsInput(
                "Revision limit reached. Resolve findings in the implementation thread, then resume --recheck for independent review.",
              );
            j.revision++;
            this.stage(j, "revising");
          }
        } else if (j.stage === "revising") {
          const key = `revision-${j.revision}`;
          let op = j.operations.find((o) => o.key === key);
          if (!op) {
            op = {
              key,
              title: key,
              kind: "send",
              attempted: false,
              prompt: revisionPrompt(j),
            };
            j.operations.push(op);
            this.save(j);
          }
          if (!op.handle) {
            op.attempted = true;
            this.save(j);
            op.handle = await this.backend.send(
              j.implementation!,
              op.prompt,
              `${j.id}:${key}`,
            );
            this.save(j);
          }
          const t = await this.operations.read(j, op, true);
          if (!t) return j;
          j.evidence = parseEvidence(j, t.result!);
          j.candidate = await this.git.candidate(j.workspace!);
          this.stage(j, "reviewing");
        } else if (j.stage === "validating") {
          if (!j.config.validation.length)
            throw new NeedsInput("Required validation commands are missing.");
          if ((await this.git.candidate(j.workspace!)) !== j.candidate)
            throw new NeedsInput(
              "Candidate changed before validation; use resume --recheck.",
            );
          for (const v of j.config.validation) {
            // Re-run incomplete/failed validations; completed results are reusable only on the same tree.
            if (hasPassingValidation(j, v.name)) continue;
            j.validationInFlight = v.name;
            this.save(j);
            const r = await this.git.run(
              v.argv,
              j.workspace!,
              undefined,
              v.timeoutMs,
            );
            if (r.code !== 124) delete j.validationInFlight;
            j.validations.push({
              ...r,
              name: v.name,
              argv: v.argv,
              revision: j.candidate!,
            });
            this.save(j);
            if ((await this.git.candidate(j.workspace!)) !== j.candidate)
              throw new NeedsInput(
                "Validation modified tracked/unignored files. Inspect changes, then resume --recheck for fresh review and validation.",
              );
            if (r.code !== 0)
              throw new NeedsInput(
                `Required validation failed: ${v.name} (exit ${r.code}). Fix in the implementation thread, then resume --recheck.`,
              );
          }
          this.stage(j, "publishing");
        } else if (j.stage === "publishing") {
          // Reconcile both agent threads before allowing irreversible publication.
          for (const h of [j.implementation!, j.reviews.at(-1)!.handle]) {
            const t = await this.backend.read(h);
            if (
              t.status !== "completed" ||
              t.pending ||
              t.handle.runId !== h.runId
            )
              throw new NeedsInput(
                "An agent thread changed after review; reconcile in T3 and resume --recheck.",
              );
          }
          await this.git.publish(j, () => this.save(j), opts.retryPublish);
          await this.backend.link(j.implementation!, j.publication.url!);
          j.publication.linked = true;
          this.stage(j, "pr_open");
          return j;
        } else return j;
      }
      return j;
    } catch (e) {
      j.outcome =
        e instanceof NeedsInput ||
        (e instanceof Error &&
          /uncertain|gate|changed|PR|validation/.test(e.message))
          ? "needs_input"
          : "failed";
      j.error = e instanceof Error ? e.message : String(e);
      this.save(j);
      return j;
    }
  };
}
