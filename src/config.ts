import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
const command = z
  .array(z.string())
  .min(1)
  .refine((v) => v[0].trim().length > 0);
export const configSchema = z
  .object({
    version: z.literal(1),
    t3: z
      .object({
        url: z.url().optional(),
        projectId: z.string().optional(),
        modelSelection: z
          .object({ instanceId: z.string(), model: z.string() })
          .optional(),
      })
      .strict(),
    validation: z.array(
      z
        .object({
          name: z.string().min(1),
          argv: command,
          timeoutMs: z.number().int().positive().default(300_000),
        })
        .strict(),
    ),
    maxRevisions: z.number().int().min(0).max(10).default(2),
    baseBranch: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/)
      .default("main"),
    remote: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
      .default("origin"),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = {
  version: 1,
  t3: {},
  validation: [],
  maxRevisions: 2,
  baseBranch: "main",
  remote: "origin",
};
export const config = (root: string): Config => {
  if (!existsSync(join(root, "flow.config.json")))
    throw new Error("Run flow init first.");
  return configSchema.parse(
    JSON.parse(readFileSync(join(root, "flow.config.json"), "utf8")),
  );
};
