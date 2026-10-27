import { type Feature } from "../features/documents.js";
import { Store } from "../state-store.js";
import { choose } from "./prompts.js";
import { type Ask } from "./terminal.js";
export const selectFeature = async (
  ask: Ask,
  action: string,
  features: Feature[],
  store: Store,
): Promise<string | undefined> => {
  const choices = features
    .filter((f) => {
      const j = store.latest(f.id);
      if (action === "ready") return f.status !== "cancelled";
      if (action === "run")
        return (
          f.status === "ready" &&
          store.approval(f.id) === f.hash &&
          (!j || j.outcome === "cancelled")
        );
      if (action === "resume" || action === "cancel")
        return (
          j &&
          j.outcome !== "cancelled" &&
          (action === "resume"
            ? j.stage !== "pr_open" || !j.publication.linked
            : j.stage !== "pr_open")
        );
      return true;
    })
    .map((f) => ({
      value: f.id,
      label: `${f.title} (${f.id}) — ${f.status}, ${store.latest(f.id)?.stage ?? "not started"}`,
    }));
  // Job recovery must work even if a document was removed or renamed.
  if (action === "resume" || action === "cancel") {
    for (const j of store.jobs())
      if (
        !features.some((f) => f.id === j.featureId) &&
        !choices.some((c) => c.value === j.featureId) &&
        j.outcome !== "cancelled" &&
        j.stage !== "pr_open"
      )
        choices.push({
          value: j.featureId,
          label: `${j.title} (${j.featureId}) — ${j.stage}, document missing`,
        });
  }
  if (!choices.length)
    throw new Error(
      action === "run"
        ? "No approved features available. Use flow ready to approve a document first."
        : `No features available for ${action}. Use flow new to create a draft, or flow status to inspect existing work.`,
    );
  return choose(ask, `Select a feature to ${action}:`, choices);
};
