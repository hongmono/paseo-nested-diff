import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";

export const PANEL_ID = "worktree-diff";

export function openInExplorer(client: PluginClientContext, workspaceId: string) {
  client.openPanel(PANEL_ID, { workspaceId, location: "explorer" });
}

interface Pill {
  workspaceId: string;
  registration: PluginButtonRegistration;
}

// Desktop/web only: one "Diff" pill per agent composer. Native uses the sidebar surface instead.
// Pills are reconciled, never re-added for an agent that already has one, because removing or
// updating a button closes whatever it has open.
export function contributeComposerPills(client: PluginClientContext): () => void {
  if (Platform.OS !== "web") return () => {};
  const pills = new Map<string, Pill>();
  const lifetime = new AbortController();
  let stopped = false;

  const ensure = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId) return;
    const workspaceId = agent.workspaceId;
    const existing = pills.get(agent.id);
    if (existing?.workspaceId === workspaceId) return;
    existing?.registration.remove();
    pills.set(agent.id, {
      workspaceId,
      registration: client.addComposerPill({
        id: "open-nested-diff",
        workspaceId,
        agentId: agent.id,
        button: {
          title: "Open Nested Diff",
          icon: "FileDiff",
          label: "Diff",
          behavior: { kind: "action", onPress: () => openInExplorer(client, workspaceId) },
        },
      }),
    });
  };
  const drop = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          const live = new Set(entries.map(({ agent }) => agent.id));
          for (const agentId of [...pills.keys()]) if (!live.has(agentId)) drop(agentId);
          for (const { agent } of entries) ensure(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") drop(update.agentId);
          else ensure(update.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[paseo-nested-diff] agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const agentId of [...pills.keys()]) drop(agentId);
  };
}
