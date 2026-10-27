import { z } from "zod";
export const handleSchema = z.object({
  threadId: z.string(),
  runId: z.string().nullable().optional(),
});
// Wire schemas deliberately validate only fields consumed; T3 can add other fields.
export const readSchema = z.object({
  thread: z.object({
    threadId: z.string(),
    latestRunId: z.string().nullable(),
    status: z.string(),
    pendingRequestCount: z.number(),
    worktreePath: z.string().nullable(),
    branch: z.string().nullable(),
    projectId: z.string(),
  }),
  recentRuns: z.array(z.object({ runId: z.string(), status: z.string() })),
  items: z.array(
    z.object({
      itemId: z.string(),
      type: z.string(),
      createdBy: z.string().nullable(),
      runId: z.string().nullable(),
      text: z.string().nullable(),
      textTruncated: z.boolean(),
      nextTextOffset: z.number().nullable().optional(),
    }),
  ),
  hasMore: z.boolean(),
  nextPosition: z.number().nullable(),
});
