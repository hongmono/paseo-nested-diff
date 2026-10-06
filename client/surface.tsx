import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { worktreeDiffRpc } from "../shared/diff";
import { DiffView, summaryQueryKey } from "./panel";

export const SURFACE_ID = "nested-diff";
const WORKSPACES_KEY = ["nested-diff", "workspaces"] as const;
const SPLIT_WIDTH = 760;

interface WorktreeItem {
  id: string;
  title: string;
  branch: string | null;
  directory: string;
  project: string;
  changed: boolean;
  files: number | null;
  additions: number;
  deletions: number;
  activityAt: string;
}

interface ProjectGroup {
  project: string;
  items: WorktreeItem[];
}

// Survives closing and reopening the surface for the rest of the app session.
let lastSelected: string | null = null;

type ListedWorkspace = Awaited<ReturnType<ReturnType<typeof usePaseo>["workspaces"]["list"]>>["entries"][number];

function toItem(workspace: ListedWorkspace): WorktreeItem | null {
  if (workspace.archivingAt) return null;
  const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
  return {
    id: workspace.id,
    title: workspace.title || workspace.name,
    branch: workspace.gitRuntime?.currentBranch ?? null,
    directory,
    project: workspace.projectCustomName || workspace.projectDisplayName,
    changed: false,
    files: null,
    additions: 0,
    deletions: 0,
    activityAt: workspace.activityAt ?? workspace.statusEnteredAt ?? "",
  };
}

function byRelevance(a: WorktreeItem, b: WorktreeItem): number {
  if (a.changed !== b.changed) return a.changed ? -1 : 1;
  return b.activityAt.localeCompare(a.activityAt);
}

function groupByProject(items: WorktreeItem[]): ProjectGroup[] {
  const groups = new Map<string, WorktreeItem[]>();
  for (const item of items) groups.set(item.project, [...(groups.get(item.project) ?? []), item]);
  return [...groups.entries()]
    .map(([project, entries]) => ({ project, items: entries.sort(byRelevance) }))
    .sort((a, b) => byRelevance(a.items[0]!, b.items[0]!));
}

function WorktreeRow({ theme, item, selected, onPress }: { theme: PluginTheme; item: WorktreeItem; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show diff for ${item.title}`}
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 2,
        borderRadius: 8,
        backgroundColor: selected ? theme.colors.surface2 : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 14 }}>
          {item.title}
        </Text>
        {item.files === null ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>…</Text>
        ) : item.files === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>no changes</Text>
        ) : (
          <Text style={{ fontSize: 12 }}>
            <Text style={{ color: theme.colors.foregroundMuted }}>{item.files} files </Text>
            <Text style={{ color: theme.colors.statusSuccess }}>+{item.additions}</Text>
            <Text style={{ color: theme.colors.foregroundMuted }}> </Text>
            <Text style={{ color: theme.colors.statusDanger }}>-{item.deletions}</Text>
          </Text>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {item.branch ?? "no branch"}
      </Text>
    </Pressable>
  );
}

function WorktreePicker({
  theme,
  groups,
  selectedId,
  loading,
  error,
  onSelect,
  onRefresh,
}: {
  theme: PluginTheme;
  groups: ProjectGroup[];
  selectedId: string | null;
  loading: boolean;
  error: Error | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={{ padding: 10, gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4 }}>
        <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>Worktrees</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh worktrees" onPress={onRefresh} style={{ padding: 6 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{loading ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={{ color: theme.colors.statusDanger, paddingHorizontal: 4 }}>{error.message}</Text> : null}
      {!loading && !error && groups.length === 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, paddingHorizontal: 4 }}>No workspaces on this host.</Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.project} style={{ gap: 2 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600", paddingHorizontal: 4, paddingBottom: 2 }}>
            {group.project}
          </Text>
          {group.items.map((item) => (
            <WorktreeRow key={item.id} theme={theme} item={item} selected={item.id === selectedId} onPress={() => onSelect(item.id)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export function NestedDiffSurface({ theme, layout }: PluginSurfaceProps) {
  const paseo = usePaseo();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(lastSelected);
  const [width, setWidth] = useState(0);
  const split = !layout.compact && width >= SPLIT_WIDTH;

  const workspaces = useQuery({
    queryKey: WORKSPACES_KEY,
    queryFn: async () => (await paseo.workspaces.list()).entries,
  });
  useEffect(() => paseo.workspaces.subscribe(() => void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY })), [paseo, queryClient]);

  const baseItems = useMemo(() => (workspaces.data ?? []).map(toItem).filter((item): item is WorktreeItem => item !== null), [workspaces.data]);
  const callSummary = useRpc(worktreeDiffRpc);
  const summaries = useQueries({
    queries: baseItems.map((item) => ({
      queryKey: summaryQueryKey(item.directory),
      queryFn: () => callSummary({ root: item.directory }),
      staleTime: 30_000,
    })),
  });
  const items = baseItems.map((item, index): WorktreeItem => {
    const repos = summaries[index]?.data?.repos;
    if (!repos) return item;
    const files = repos.reduce((sum, repo) => sum + repo.files.length, 0);
    return {
      ...item,
      files,
      changed: files > 0,
      additions: repos.reduce((sum, repo) => sum + repo.additions, 0),
      deletions: repos.reduce((sum, repo) => sum + repo.deletions, 0),
    };
  });
  const groups = groupByProject(items);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const select = (id: string | null) => {
    lastSelected = id;
    setSelectedId(id);
  };

  const picker = (
    <WorktreePicker
      theme={theme}
      groups={groups}
      selectedId={selected?.id ?? null}
      loading={workspaces.isFetching}
      error={workspaces.error}
      onSelect={select}
      onRefresh={() => void queryClient.invalidateQueries({ queryKey: WORKSPACES_KEY })}
    />
  );
  const diff = selected ? (
    <DiffView key={selected.id} theme={theme} layout={layout} directory={selected.directory} />
  ) : (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>Pick a worktree to see its final diff.</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {split ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ width: 300, borderRightWidth: 1, borderRightColor: theme.colors.border }}>{picker}</View>
          <View style={{ flex: 1 }}>{diff}</View>
        </View>
      ) : selected ? (
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to worktrees"
            onPress={() => select(null)}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
          >
            <Text style={{ color: theme.colors.accent, fontSize: 14 }}>‹ Worktrees</Text>
            <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 13 }}>
              {selected.project} · {selected.title}
            </Text>
          </Pressable>
          {diff}
        </View>
      ) : (
        picker
      )}
    </View>
  );
}
