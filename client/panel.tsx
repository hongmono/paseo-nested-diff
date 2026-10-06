import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { type DiffFile, type RepoDiff, filePatchRpc, worktreeDiffRpc } from "../shared/diff";

const MONOSPACE = Platform.select({ ios: "Menlo", macos: "Menlo", default: "monospace" });
const QUERY_ROOT = "nested-diff";
export const summaryQueryKey = (directory: string | null) => [QUERY_ROOT, "summary", directory] as const;
// The Explorer is narrow on desktop too, where layout.compact stays false.
const NARROW_WIDTH = 480;

function withAlpha(color: string, alpha: string, fallback = "transparent"): string {
  return /^#(?:[0-9a-f]{6})$/i.test(color.trim()) ? `${color.trim()}${alpha}` : fallback;
}

function statusLabel(status: DiffFile["status"]): string {
  return status === "untracked" ? "U?" : status;
}

function statusColor(theme: PluginTheme, status: DiffFile["status"]): string {
  switch (status) {
    case "A":
    case "untracked":
      return theme.colors.statusSuccess;
    case "D":
      return theme.colors.statusDanger;
    case "R":
    case "C":
      return theme.colors.accent;
    default:
      return theme.colors.statusWarning;
  }
}

function Counts({ theme, additions, deletions }: { theme: PluginTheme; additions: number | null; deletions: number | null }) {
  if (additions === null) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>binary</Text>;
  return (
    <Text style={{ fontSize: 12, fontFamily: MONOSPACE }}>
      <Text style={{ color: theme.colors.statusSuccess }}>+{additions}</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}> </Text>
      <Text style={{ color: theme.colors.statusDanger }}>-{deletions ?? 0}</Text>
    </Text>
  );
}

function PatchView({ theme, root, repoPath, file, wrap }: { theme: PluginTheme; root: string; repoPath: string; file: DiffFile; wrap: boolean }) {
  const callPatch = useRpc(filePatchRpc);
  const query = useQuery({
    queryKey: [QUERY_ROOT, "patch", root, repoPath, file.path],
    queryFn: () => callPatch({ root, repoPath, path: file.path }),
  });
  if (query.isPending) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 8 }}>Loading diff…</Text>;
  if (query.error) return <Text style={{ color: theme.colors.statusDanger, fontSize: 12, padding: 8 }}>{query.error.message}</Text>;
  if (query.data.binary) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 8 }}>Binary file.</Text>;
  const lines = query.data.patch.split("\n");
  const body = (
      <View style={{ paddingVertical: 6, minWidth: "100%" }}>
        {lines.map((line, index) => {
          let color = theme.colors.foreground;
          let background = "transparent";
          if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
            color = theme.colors.foregroundMuted;
          } else if (line.startsWith("@@")) {
            color = theme.colors.accent;
          } else if (line.startsWith("+")) {
            color = theme.colors.statusSuccess;
            background = withAlpha(theme.colors.statusSuccess, "1f");
          } else if (line.startsWith("-")) {
            color = theme.colors.statusDanger;
            background = withAlpha(theme.colors.statusDanger, "1f");
          }
          return (
            <Text
              key={index}
              style={{ color, backgroundColor: background, fontFamily: MONOSPACE, fontSize: 12, lineHeight: 17, paddingHorizontal: 8 }}
            >
              {line || " "}
            </Text>
          );
        })}
        {query.data.truncated ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 }}>… diff truncated</Text>
        ) : null}
      </View>
  );
  if (wrap) return <View style={{ backgroundColor: theme.colors.surface1 }}>{body}</View>;
  return (
    <ScrollView horizontal nestedScrollEnabled style={{ backgroundColor: theme.colors.surface1 }}>
      {body}
    </ScrollView>
  );
}

function FileRow({ theme, compact, wrap, root, repoPath, file }: { theme: PluginTheme; compact: boolean; wrap: boolean; root: string; repoPath: string; file: DiffFile }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Collapse" : "Expand"} diff for ${file.path}`}
        onPress={() => setOpen((value) => !value)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: compact ? 9 : 7, paddingHorizontal: compact ? 10 : 12 }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, width: 10 }}>{open ? "▾" : "▸"}</Text>
        <Text style={{ color: statusColor(theme, file.status), fontFamily: MONOSPACE, fontSize: 12, width: 22 }}>{statusLabel(file.status)}</Text>
        <Text numberOfLines={1} ellipsizeMode="head" style={{ flex: 1, color: theme.colors.foreground, fontSize: 13 }}>
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </Text>
        <Counts theme={theme} additions={file.additions} deletions={file.deletions} />
      </Pressable>
      {open ? <PatchView theme={theme} root={root} repoPath={repoPath} file={file} wrap={wrap} /> : null}
    </View>
  );
}

function RepoSection({ theme, compact, wrap, root, repo }: { theme: PluginTheme; compact: boolean; wrap: boolean; root: string; repo: RepoDiff }) {
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 } as const;
  return (
    <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surface0 }}>
      <View style={{ padding: compact ? 10 : 12, gap: 4, backgroundColor: theme.colors.surface1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{repo.name}</Text>
          {compact ? null : <Text numberOfLines={1} style={[muted, { flexShrink: 1 }]}>{repo.branch ?? "no branch"}</Text>}
          <View style={{ flex: 1 }} />
          <Counts theme={theme} additions={repo.additions} deletions={repo.deletions} />
          <Text style={muted}>{repo.files.length} {repo.files.length === 1 ? "file" : "files"}</Text>
        </View>
        {compact ? <Text numberOfLines={1} style={muted}>{repo.branch ?? "no branch"}</Text> : null}
        <Text numberOfLines={1} style={[muted, { fontFamily: MONOSPACE, fontSize: 11 }]}>
          base {repo.base ?? "—"}{repo.mergeBase ? ` @ ${repo.mergeBase.slice(0, 10)}` : ""}
        </Text>
        {repo.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{repo.error}</Text> : null}
      </View>
      {repo.files.length === 0 && !repo.error ? (
        <Text style={[muted, { paddingHorizontal: compact ? 10 : 12, paddingVertical: 8 }]}>No changes</Text>
      ) : null}
      {repo.files.map((file) => (
        <FileRow key={file.path} theme={theme} compact={compact} wrap={wrap} root={root} repoPath={repo.path} file={file} />
      ))}
    </View>
  );
}

export function WorktreeDiffPanel({ theme, layout, workspaceId }: Pick<PluginWorkspacePanelProps, "theme" | "layout" | "workspaceId">) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  return <DiffView theme={theme} layout={layout} directory={directory ?? null} />;
}

export function DiffView({
  theme,
  layout,
  directory,
}: Pick<PluginWorkspacePanelProps, "theme" | "layout"> & { directory: string | null }) {
  const [wrap, setWrap] = useState(false);
  const [width, setWidth] = useState(0);
  const compact = layout.compact || (width > 0 && width < NARROW_WIDTH);
  const callSummary = useRpc(worktreeDiffRpc);
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: summaryQueryKey(directory),
    queryFn: () => callSummary({ root: directory! }),
    enabled: Boolean(directory),
  });

  const totals = useMemo(() => {
    const repos = summary.data?.repos ?? [];
    return {
      files: repos.reduce((sum, repo) => sum + repo.files.length, 0),
      additions: repos.reduce((sum, repo) => sum + repo.additions, 0),
      deletions: repos.reduce((sum, repo) => sum + repo.deletions, 0),
    };
  }, [summary.data]);

  const padding = compact ? 10 : 16;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: padding,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: compact ? 14 : 15, fontWeight: "600" }}>Final diff vs base</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {summary.data ? `${totals.files} files · ` : ""}
            {summary.data ? <Counts theme={theme} additions={totals.additions} deletions={totals.deletions} /> : "merge-base → working tree"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: wrap }}
          accessibilityLabel="Wrap long lines"
          onPress={() => setWrap((value) => !value)}
          style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: wrap ? theme.colors.accent : theme.colors.border }}
        >
          <Text style={{ color: wrap ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 13 }}>Wrap</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh diff"
          disabled={summary.isFetching}
          onPress={() => void queryClient.invalidateQueries({ queryKey: [QUERY_ROOT] })}
          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: theme.colors.accent, opacity: summary.isFetching ? 0.6 : 1 }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 13 }}>{summary.isFetching ? "Loading…" : "Refresh"}</Text>
        </Pressable>
      </View>
      <ScrollView directionalLockEnabled nestedScrollEnabled contentContainerStyle={{ padding, gap: compact ? 10 : 12 }}>
        {!directory ? <Text style={{ color: theme.colors.foregroundMuted }}>Loading workspace…</Text> : null}
        {summary.error ? <Text style={{ color: theme.colors.statusDanger }}>{summary.error.message}</Text> : null}
        {summary.data && summary.data.repos.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>This workspace is not inside a git repository.</Text>
        ) : null}
        {summary.data?.repos.map((repo) => (
          <RepoSection key={repo.path} theme={theme} compact={compact} wrap={wrap} root={summary.data.root} repo={repo} />
        ))}
      </ScrollView>
    </View>
  );
}
