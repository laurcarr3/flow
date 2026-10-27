import { type Job } from "./job.js";
export const hasPassingValidation = (job: Job, name: string): boolean =>
  job.validations.some(
    (result) =>
      result.name === name &&
      result.revision === job.candidate &&
      result.code === 0 &&
      !result.invalidated,
  );
