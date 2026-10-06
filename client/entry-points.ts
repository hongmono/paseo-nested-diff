import type { PluginButtonBehavior, PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { createElement } from "react";
import { Dimensions, Platform, View } from "react-native";
import { WorktreeDiffPanel } from "./panel";

export const PANEL_ID = "worktree-diff";

export function openInExplorer(client: PluginClientContext, workspaceId: string) {
  client.openPanel(PANEL_ID, { workspaceId, location: "explorer" });
}

function DiffSheet({ theme, layout, workspaceId }: PluginButtonContentProps) {
  return createElement(
    View,
    { style: { height: Math.round(Dimensions.get("window").height * 0.75) } },
    createElement(WorktreeDiffPanel, { theme, layout, workspaceId }),
  );
}

function pillBehavior(client: PluginClientContext, workspaceId: string): PluginButtonBehavior {
  if (Platform.OS === "web") return { kind: "action", onPress: () => openInExplorer(client, workspaceId) };
  return { kind: "popover", Content: DiffSheet };
}

// One "Diff" pill per agent composer, following the agent directory through an owned list subscription.
export function contributeComposerPills(client: PluginClientContext): () => void {
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let stopped = false;

  const register = (agent: { id: string; workspaceId?: string | null }) => {
    if (stopped || !agent.workspaceId) return;
    pills.get(agent.id)?.remove();
    const workspaceId = agent.workspaceId;
    pills.set(
      agent.id,
      client.addComposerPill({
        id: "open-nested-diff",
        workspaceId,
        agentId: agent.id,
        button: {
          title: "Open Nested Diff",
          icon: "FileDiff",
          label: "Diff",
          behavior: pillBehavior(client, workspaceId),
        },
      }),
    );
  };
  const unregister = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };
  const clear = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          clear();
          for (const { agent } of entries) register(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") unregister(update.agentId);
          else register(update.agent);
        },
      });
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[paseo-nested-diff] agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    clear();
  };
}
