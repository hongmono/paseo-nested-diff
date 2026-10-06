import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PANEL_ID, contributeComposerPills } from "./client/entry-points";
import { WorktreeDiffPanel } from "./client/panel";
import { NestedDiffSurface, SURFACE_ID } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface(SURFACE_ID, NestedDiffSurface);
  client.addSidebarItem({
    id: "nested-diff",
    title: "Nested Diff",
    icon: "FileDiff",
    surface: SURFACE_ID,
  });

  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Nested Diff",
    icon: "FileDiff",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: WorktreeDiffPanel,
  });

  client.addCommandCenterItem({
    id: "open-worktree-diff",
    title: "Open Worktree Diff",
    icon: "FileDiff",
    keywords: ["diff", "git", "changes", "worktree", "nested", "merge-base"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID, { location: "explorer" });
    },
  });

  return contributeComposerPills(client);
}
