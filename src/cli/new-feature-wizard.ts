import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { discover, idSchema } from "../features/documents.js";
import { draft, type Draft } from "../features/draft-feature.js";
import {
  DirectDrafter,
  draftProviderSchema,
} from "../features/draft-provider.js";
import { Store } from "../state-store.js";
import { type Ask } from "./terminal.js";

export const nextFeatureId = (root: string, store: Store): string => {
  const base =
    basename(root)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70)
      .replace(/-$/g, "") || "feature";
  const used = new Set([
    ...discover(root).map((f) => f.id),
    ...store.jobs().map((j) => j.featureId),
    ...store.drafts().map((d) => d.id),
  ]);
  for (let number = 1; ; number++) {
    const id = number === 1 ? base : `${base}-${number}`;
    if (!used.has(id) && !existsSync(join(root, "features", `${id}.md`)))
      return idSchema.parse(id);
  }
};

export const newFeatureWizard = async (
  root: string,
  store: Store,
  ask: Ask,
  drafter = new DirectDrafter(),
): Promise<string> => {
  const featureIds = new Set(discover(root).map((f) => f.id));
  const pending = (store.drafts() as Draft[]).filter(
    (d) =>
      !d.saved &&
      !featureIds.has(d.id) &&
      !existsSync(join(root, "features", `${d.id}.md`)),
  );
  let saved: Draft | undefined;
  if (pending.length) {
    const choices = pending
      .map(
        (d, i) =>
          `${i + 1}: ${d.id} — ${d.input.replace(/\s+/g, " ").slice(0, 80)}`,
      )
      .join("\n");
    for (;;) {
      const answer = (
        await ask(
          `Saved draft requests:\n${choices}\nContinue a request [1-${pending.length}], or enter new [new]: `,
        )
      )
        .trim()
        .toLowerCase();
      if (!answer || answer === "new") break;
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && pending[index]) {
        saved = pending[index];
        break;
      }
    }
  }
  const id = saved?.id ?? nextFeatureId(root, store);
  const last = saved?.attempts?.at(-1);
  if (last?.state === "completed") {
    // Reuse persisted output before offering any new invocation.
    return draft(root, store, drafter, id);
  }
  let retry = false;
  if (last || saved?.attempted || saved?.handle) {
    const location = saved?.handle
      ? ` Stop or finish t3-thread://v1/${saved.handle.threadId} first.`
      : "";
    const answer = await ask(
      `The previous attempt for ${id} did not complete.${location} Confirm the previous agent has stopped and retry? [y/N]: `,
    );
    if (answer.trim().toLowerCase() !== "y")
      return `Kept the saved request for ${id}. Run flow new when you are ready to continue.`;
    retry = true;
  }
  let provider;
  for (;;) {
    const answer = (
      await ask(
        `Drafting provider [codex/claude] (${saved?.provider ?? "codex"}): `,
      )
    )
      .trim()
      .toLowerCase();
    const parsed = draftProviderSchema.safeParse(
      answer || saved?.provider || "codex",
    );
    if (parsed.success) {
      provider = parsed.data;
      break;
    }
  }
  let input = saved?.input;
  while (!input?.trim())
    input = (
      await ask(`Feature ID: ${id}\nWhat do you want to implement? `)
    ).trim();
  return draft(root, store, drafter, id, input, provider, retry);
};
