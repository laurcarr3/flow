import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CommandResult } from "../process.js";
import { Store } from "../state-store.js";
import {
  contentErrors,
  discover,
  graphErrors,
  idSchema,
  parseFeature,
  withStatus,
} from "./documents.js";
import {
  DirectDrafter,
  draftProviderSchema,
  parseDraftResult,
  type DraftProvider,
} from "./draft-provider.js";

type Attempt = {
  requestId: string;
  provider: DraftProvider;
  state: "running" | "completed" | "failed";
  result?: CommandResult;
  sessionId?: string;
  error?: string;
};
export type Draft = {
  id: string;
  input: string;
  provider?: DraftProvider;
  attempts?: Attempt[];
  saved?: boolean;
  // Old T3 draft records retain their input and handles for manual reconciliation.
  attempted?: boolean;
  handle?: { threadId: string };
};
export const draft = async (
  root: string,
  store: Store,
  drafter: DirectDrafter,
  id: string,
  input?: string,
  provider?: DraftProvider,
  retryDraft = false,
): Promise<string> => {
  idSchema.parse(id);
  let d: Draft = store.draft(id);
  if (
    d?.saved ||
    existsSync(join(root, "features", `${id}.md`)) ||
    discover(root).some((f) => f.id === id)
  ) {
    throw new Error("Feature already exists; edit its Markdown file.");
  }
  if (!d) {
    if (!input?.trim())
      throw new Error(
        "Provide --prompt, --stdin, or an interactive description.",
      );
    d = { id, input, attempts: [] };
    store.draft(id, d);
  }
  try {
    if (input && input !== d.input)
      throw new Error(
        "A saved request exists. Omit --prompt to use it; edit the generated document to refine scope.",
      );
    if (!provider && !d.provider)
      throw new Error(
        "Select a drafting provider with --provider codex or --provider claude.",
      );
    const selected = draftProviderSchema.parse(provider ?? d.provider);
    if (d.provider && selected !== d.provider && !retryDraft)
      throw new Error("Changing the drafting provider requires --retry-draft.");
    if ((d.attempted || d.handle) && !d.attempts?.length && !retryDraft) {
      throw new Error(
        `This request used T3 drafting. Stop or finish its old thread before using --provider ${selected} --retry-draft.${d.handle ? ` Thread: t3-thread://v1/${d.handle.threadId}` : ""}`,
      );
    }
    d.attempts ??= [];
    let attempt = d.attempts.at(-1);
    if (attempt && !retryDraft && attempt.state !== "completed") {
      throw new Error(
        "The last draft did not complete. Confirm its local agent process has stopped, then use --retry-draft.",
      );
    }
    if (!attempt || retryDraft) {
      d.provider = selected;
      attempt = {
        requestId: randomUUID(),
        provider: selected,
        state: "running",
      };
      d.attempts.push(attempt);
      store.draft(id, d);
      const prompt = `Draft a minimal feature PRD. Read relevant repository context and applicable AGENTS.md or CLAUDE.md instructions. Do not modify files, implement code, delegate work, or use T3. Use only local read-only inspection. This is a noninteractive drafting task: record material questions and uncertainty under Open questions rather than inventing answers. Return ONLY Markdown with YAML frontmatter id: ${id}, status: draft, depends_on: [] (optional group), a # title, and ## Outcome, ## Requirements, ## Acceptance criteria, ## Out of scope, ## Open questions. Make outcome, requirements, and acceptance criteria concrete. User request:\n${d.input}`;
      try {
        attempt.result = await drafter.generate(
          selected,
          attempt.requestId,
          root,
          prompt,
        );
        attempt.state = attempt.result.code === 0 ? "completed" : "failed";
      } catch (e) {
        attempt.state = "failed";
        attempt.error = e instanceof Error ? e.message : String(e);
      }
      store.draft(id, d);
    }
    if (attempt.state !== "completed" || !attempt.result) {
      const login = selected === "codex" ? "codex login" : "claude auth login";
      throw new Error(
        `${selected} drafting failed${attempt.result ? ` (exit ${attempt.result.code})` : ""}. Install the CLI and authenticate with ${login}. ${attempt.error ?? attempt.result?.stderr.slice(-1500) ?? ""} Confirm the agent has stopped before retrying with --retry-draft.`,
      );
    }
    const result = parseDraftResult(attempt.provider, attempt.result.stdout);
    attempt.sessionId = result.sessionId;
    store.draft(id, d);
    const raw =
      result.markdown
        .trim()
        .replace(/^```(?:markdown|md)?\s*\n/, "")
        .replace(/\n```$/, "") + "\n";
    const parsed = parseFeature(raw);
    if (parsed.id !== id)
      throw new Error("Agent returned a different feature ID.");
    const f = parseFeature(withStatus(parsed, "draft"));
    const errors = [
      ...contentErrors(f),
      ...graphErrors([...discover(root), f]),
    ];
    if (errors.length) throw new Error(errors.join("\n"));
    writeFileSync(join(root, "features", `${id}.md`), f.raw, { flag: "wx" });
    d.saved = true;
    store.draft(id, d);
    return `Saved features/${id}.md as draft using ${attempt.provider}. Edit it, then run flow ready ${id}.`;
  } catch (e) {
    throw new Error(
      `${e instanceof Error ? e.message : e}\nYour input is preserved in .flow/state.sqlite. Use flow new --id ${id}${d.provider ? "" : " --provider codex|claude"} to collect saved output. Use --retry-draft to request new output after confirming the prior process has stopped.`,
    );
  }
};
