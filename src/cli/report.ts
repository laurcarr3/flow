import type { Job } from "../workflow/job.js";
import { formatJobDetails, formatJobHeading } from "./output.js";

export const report = (job: Job) => {
  console.log(formatJobHeading(job));
  if (job.error) console.error(job.error);
  for (const line of formatJobDetails(job)) console.log(line);
  if (job.outcome !== "active") process.exitCode = 2;
};
