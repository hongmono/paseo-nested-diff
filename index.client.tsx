import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WorktreeDiffPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "worktree-diff",
    title: "Worktree Diff",
    icon: "FileDiff",
    context: "workspace",
    Component: WorktreeDiffPanel,
  });

  client.addCommandCenterItem({
    id: "open-worktree-diff",
    title: "Open Worktree Diff",
    icon: "FileDiff",
    keywords: ["diff", "git", "changes", "worktree", "nested", "merge-base"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("worktree-diff");
    },
  });

  return () => {};
}
