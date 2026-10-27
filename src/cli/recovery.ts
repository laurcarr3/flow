import { type Job, type ResumeOptions } from "../workflow/job.js";
import { choose, confirm } from "./prompts.js";
import { type Ask } from "./terminal.js";
export const recoveryOptions = async (
  ask: Ask,
  j: Job,
): Promise<ResumeOptions | undefined> => {
  const options = [
    {
      value: "continue",
      label: "Continue — reconcile saved work with T3 and GitHub",
    },
  ];
  if (
    j.workspace &&
    ["reviewing", "validating", "publishing"].includes(j.stage) &&
    !j.publication.attempted &&
    !j.publication.pushed
  )
    options.push({
      value: "recheck",
      label:
        "Review and validate again after manual fixes or an invalid review",
    });
  if (j.operations.some((o) => o.kind === "launch" && o.attempted && !o.handle))
    options.push({
      value: "launch",
      label: "Retry a launch after checking that no T3 thread exists",
    });
  if (j.publication.attempted && !j.publication.url)
    options.push({
      value: "publish",
      label: "Retry PR creation after checking that no PR exists",
    });
  const choice = await choose(
    ask,
    `Resume ${j.featureId}${j.error ? `\n${j.error}` : ""}`,
    options,
    "continue",
  );
  if (!choice) return;
  const result: ResumeOptions = {};
  if (j.validationInFlight) {
    if (
      !(await confirm(
        ask,
        `Validation ${j.validationInFlight} may still be running. Have you confirmed that its processes have stopped?`,
      ))
    )
      return;
    result.retryValidation = true;
    result.recheck = await confirm(
      ask,
      "Did files change or do you need a fresh review?",
    );
  }
  if (choice === "launch") {
    if (
      !(await confirm(
        ask,
        "Have you inspected T3 and confirmed that the uncertain launch created no thread?",
      ))
    )
      return;
    result.retryLaunch = true;
  }
  if (choice === "publish") {
    if (
      !(await confirm(
        ask,
        "Have you inspected GitHub and confirmed that no PR exists for this job's branch?",
      ))
    )
      return;
    result.retryPublish = true;
  }
  if (choice === "recheck") result.recheck = true;
  return result;
};
