import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";

export const PANEL_ID = "worktree-diff";
const TITLE = "Worktree Diff";
const ICON = "FileDiff";

function openFor(client: PluginClientContext, workspaceId: string) {
  client.openPanel(PANEL_ID, { workspaceId });
}

// The Command Center is desktop-only, so mobile reaches the panel through a header button and `/diff`.
export function contributeEntryPoints(client: PluginClientContext): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();
  let stopped = false;
  let releaseWorkspaces: (() => void) | null = null;

  const register = (workspaceId: string) => {
    if (stopped || buttons.has(workspaceId)) return;
    buttons.set(
      workspaceId,
      client.addHeaderButton({
        id: "open-worktree-diff",
        workspaceId,
        button: {
          title: TITLE,
          icon: ICON,
          label: "Diff",
          behavior: { kind: "action", onPress: () => openFor(client, workspaceId) },
        },
      }),
    );
  };
  const unregister = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };

  void client.paseo.workspaces
    .list({ subscribe: {} })
    .then(({ subscription }) => {
      const release = () => {
        unsubscribe();
        void subscription.release();
      };
      const unsubscribe = subscription.subscribe({
        snapshot: ({ entries }) => {
          const live = new Set(entries.map((workspace) => workspace.id));
          for (const id of [...buttons.keys()]) if (!live.has(id)) unregister(id);
          for (const id of live) register(id);
        },
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const update = message.payload;
          if (update.kind === "remove") unregister(update.id);
          else register(update.workspace.id);
        },
      });
      if (stopped) release();
      else releaseWorkspaces = release;
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[paseo-nested-diff] workspace observation failed", error);
    });

  const removeWorkspaceCommand = client.addSlashCommand({
    name: "diff",
    description: "Open the final diff across this workspace and its nested repos",
    argumentHint: "",
    context: "workspace",
    onSubmit: ({ workspace }) => openFor(client, workspace.id),
  });
  const removeAgentCommand = client.addSlashCommand({
    name: "diff",
    description: "Open the final diff across this workspace and its nested repos",
    argumentHint: "",
    context: "agent",
    onSubmit: ({ workspace }) => openFor(client, workspace.id),
  });

  return () => {
    stopped = true;
    releaseWorkspaces?.();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    removeWorkspaceCommand();
    removeAgentCommand();
  };
}
