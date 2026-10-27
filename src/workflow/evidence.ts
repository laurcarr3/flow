import { evidenceSchema, resultJson } from "../executor.js";
import { acceptanceCriteria, parseFeature } from "../features/documents.js";
import { NeedsInput } from "./errors.js";
import type { Job } from "./job.js";

export const parseEvidence = (j: Job, text: string) => {
  const evidence = evidenceSchema.parse(resultJson(text));
  const missing = acceptanceCriteria(parseFeature(j.snapshot)).filter(
    (c) => !evidence.acceptance.some((a) => a.criterion === c),
  );
  if (missing.length)
    throw new NeedsInput(
      `Implementation evidence missing exact acceptance criteria: ${missing.join("; ")}. Ask the implementation thread to return complete JSON evidence, then resume.`,
    );
  return evidence;
};
