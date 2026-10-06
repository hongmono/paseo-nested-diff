import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readFilePatch, readWorktreeCommits, readWorktreeDiff } from "./server/diff";
import { commitsRpc, filePatchRpc, worktreeDiffRpc } from "./shared/diff";

export default function contribute(server: PluginServerContext) {
  server.handle(worktreeDiffRpc, readWorktreeDiff);
  server.handle(filePatchRpc, readFilePatch);
  server.handle(commitsRpc, readWorktreeCommits);
  return () => {};
}
