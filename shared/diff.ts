import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FILE_STATUSES = ["A", "M", "D", "R", "C", "T", "U", "untracked"] as const;

export const diffFileSchema = z.object({
  path: z.string(),
  /** Previous path for renames and copies. */
  oldPath: z.string().nullable(),
  status: z.enum(FILE_STATUSES),
  /** Null for binary files. */
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});

export const repoDiffSchema = z.object({
  /** Absolute repository path; used as the key when asking for a file patch. */
  path: z.string(),
  /** "root" for the workspace repo, otherwise the path relative to it. */
  name: z.string(),
  kind: z.enum(["root", "nested"]),
  branch: z.string().nullable(),
  /** Ref the merge-base was computed against (origin/main or main), null when neither exists. */
  base: z.string().nullable(),
  mergeBase: z.string().nullable(),
  files: z.array(diffFileSchema),
  additions: z.number(),
  deletions: z.number(),
  error: z.string().nullable(),
});

export type DiffFile = z.infer<typeof diffFileSchema>;
export type RepoDiff = z.infer<typeof repoDiffSchema>;

export const worktreeDiffRpc = defineRpc({
  name: "nesteddiff.summary",
  input: z.object({ root: z.string() }),
  output: z.object({ root: z.string(), repos: z.array(repoDiffSchema) }),
});

export const filePatchRpc = defineRpc({
  name: "nesteddiff.file-patch",
  input: z.object({ root: z.string(), repoPath: z.string(), path: z.string() }),
  output: z.object({ patch: z.string(), truncated: z.boolean(), binary: z.boolean() }),
});
