import { type Config } from "../config.js";
import { type Evidence, type Handle, type Review } from "../executor.js";
export type Stage =
  | "preparing"
  | "implementing"
  | "reviewing"
  | "revising"
  | "validating"
  | "publishing"
  | "pr_open";
export type Outcome = "active" | "needs_input" | "failed" | "cancelled";
export type Operation = {
  key: string;
  title: string;
  kind: "launch" | "send";
  attempted: boolean;
  handle?: Handle;
  prompt: string;
};
export type Validation = {
  invalidated?: boolean;
  name: string;
  argv: string[];
  code: number;
  revision: string;
  stdout: string;
  stderr: string;
};
export type Job = {
  id: string;
  featureId: string;
  title: string;
  approvedHash: string;
  snapshot: string;
  stage: Stage;
  outcome: Outcome;
  error?: string;
  config: Config;
  base: string;
  branch: string;
  workspace?: string;
  implementation?: Handle;
  operations: Operation[];
  revision: number;
  candidate?: string;
  evidence?: Evidence;
  reviews: { candidate: string; handle: Handle; result: Review }[];
  validations: Validation[];
  validationInFlight?: string;
  publication: {
    attempted?: boolean;
    commit?: string;
    pushed?: boolean;
    url?: string;
    linked?: boolean;
  };
};

export type ResumeOptions = {
  retryLaunch?: boolean;
  retryPublish?: boolean;
  recheck?: boolean;
  retryValidation?: boolean;
};
