import { realpathSync } from "node:fs";
import {
  threadLink,
  type Executor,
  type Launch,
  type Thread,
} from "../executor.js";
import type { Git } from "../git.js";
import type { Store } from "../state-store.js";
import { NeedsInput } from "./errors.js";
import type { Job, Operation, ResumeOptions } from "./job.js";

// Persist launch intent and returned handles around every external operation.
export class AgentOperations {
  constructor(
    private root: string,
    private store: Store,
    private backend: Executor,
    private git: Git,
  ) {}
  launch = async (
    j: Job,
    key: string,
    input: Launch,
    opts: ResumeOptions,
  ): Promise<Operation> => {
    let op = j.operations.find((o) => o.key === key);
    if (!op) {
      op = {
        key,
        title: input.title,
        kind: "launch",
        attempted: false,
        prompt: input.prompt,
      };
      j.operations.push(op);
      this.store.save(j);
    }
    if (op.handle) return op;
    const matches = await this.backend.find(op.title);
    if (matches.length > 1)
      throw new NeedsInput(
        `Multiple threads match ${op.title}; reconcile in T3.`,
      );
    if (matches.length === 1) {
      op.handle = matches[0];
      this.store.save(j);
      return op;
    }
    if (op.attempted && !opts.retryLaunch)
      throw new NeedsInput(
        `Launch outcome uncertain for ${op.title}. Inspect T3 before using resume --retry-launch; no automatic duplicate launch is allowed.`,
      );
    op.attempted = true;
    this.store.save(j);
    op.handle = await this.backend.launch({ ...input, prompt: op.prompt });
    this.store.save(j);
    return op;
  };
  read = async (
    j: Job,
    op: Operation,
    implementation = false,
  ): Promise<Thread | null> => {
    const t = await this.backend.read(op.handle!);
    // Persist preparation metadata before inspecting completion.
    op.handle = t.handle;
    if (implementation) {
      j.implementation = t.handle;
      if (t.workspace) j.workspace = t.workspace;
    }
    this.store.save(j);
    if (t.workspace && t.branch) {
      await this.git.binding(this.root, t.workspace, j.branch);
      if (
        j.workspace &&
        realpathSync(j.workspace) !== realpathSync(t.workspace)
      )
        throw new NeedsInput("Reviewer is bound to the wrong workspace.");
    }
    if (t.pending)
      throw new NeedsInput(
        `Answer questions or approvals in ${threadLink(t.handle)}, then resume.`,
      );
    if (["preparing", "queued", "starting", "running"].includes(t.status))
      return null;
    if (t.status !== "completed")
      throw new NeedsInput(
        `T3 run is ${t.status}: ${threadLink(t.handle)}. Resolve it in T3, then resume.`,
      );
    if (!t.workspace || t.branch !== j.branch)
      throw new NeedsInput(
        "Completed thread has no verified dedicated workspace binding.",
      );
    if (!t.result)
      throw new NeedsInput(
        `Completed turn has no structured result: ${threadLink(t.handle)}`,
      );
    return t;
  };
}
