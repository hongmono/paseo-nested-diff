import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Platform, Text, View } from "react-native";
import { type Commit, type RepoCommits, commitsRpc } from "../shared/diff";
import { type GraphRow, layoutCommits } from "./graph-layout";

const MONOSPACE = Platform.select({ ios: "Menlo", macos: "Menlo", default: "monospace" });
const ROW_HEIGHT = 40;
const LANE_WIDTH = 12;
const MAX_LANES = 6;
const LINE = 2;
const DOT = 8;
const WORKTREE_ID = "__worktree__";

export const commitsQueryKey = (directory: string | null) => ["nested-diff", "commits", directory] as const;

function lanePalette(theme: PluginTheme): string[] {
  const { accent, statusSuccess, statusWarning, statusDanger, foregroundMuted } = theme.colors;
  return [accent, statusSuccess, statusWarning, statusDanger, foregroundMuted];
}

export function relativeDate(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function Line({ x, y, width, height, color }: { x: number; y: number; width: number; height: number; color: string }) {
  return <View style={{ position: "absolute", left: x, top: y, width, height, backgroundColor: color }} />;
}

function horizontal(from: number, to: number, color: string, key: string) {
  const left = Math.min(laneX(from), laneX(to));
  const width = Math.abs(laneX(from) - laneX(to)) + LINE;
  return <Line key={key} x={left - LINE / 2} y={ROW_HEIGHT / 2 - LINE / 2} width={width} height={LINE} color={color} />;
}

// Segments are drawn as straight vertical/horizontal Views: no SVG dependency on any platform.
function GraphCell({ row, lanes, colors, hollow }: { row: GraphRow; lanes: number; colors: string[]; hollow: boolean }) {
  const colorOf = (index: number) => colors[index % colors.length]!;
  const visible = (lane: number) => lane < lanes;
  const pieces = row.segments.flatMap((segment, index) => {
    const color = colorOf(segment.colorIndex);
    const key = `${index}`;
    if (segment.kind === "through") {
      return visible(segment.from) ? [<Line key={key} x={laneX(segment.from) - LINE / 2} y={0} width={LINE} height={ROW_HEIGHT} color={color} />] : [];
    }
    if (segment.kind === "in") {
      return [
        visible(segment.from) ? <Line key={`${key}v`} x={laneX(segment.from) - LINE / 2} y={0} width={LINE} height={ROW_HEIGHT / 2} color={color} /> : null,
        segment.from !== segment.to ? horizontal(Math.min(segment.from, lanes - 1), Math.min(segment.to, lanes - 1), color, `${key}h`) : null,
      ];
    }
    return [
      segment.from !== segment.to ? horizontal(Math.min(segment.from, lanes - 1), Math.min(segment.to, lanes - 1), color, `${key}h`) : null,
      visible(segment.to) ? <Line key={`${key}v`} x={laneX(segment.to) - LINE / 2} y={ROW_HEIGHT / 2} width={LINE} height={ROW_HEIGHT / 2} color={color} /> : null,
    ];
  });
  const dotLane = Math.min(row.lane, lanes - 1);
  const dotColor = colorOf(row.colorIndex);
  return (
    <View style={{ width: lanes * LANE_WIDTH, height: ROW_HEIGHT }}>
      {pieces}
      <View
        style={{
          position: "absolute",
          left: laneX(dotLane) - DOT / 2,
          top: ROW_HEIGHT / 2 - DOT / 2,
          width: DOT,
          height: DOT,
          borderRadius: DOT / 2,
          borderWidth: 2,
          borderColor: dotColor,
          backgroundColor: hollow ? "transparent" : dotColor,
        }}
      />
    </View>
  );
}

function CommitText({ theme, commit }: { theme: PluginTheme; commit: Commit }) {
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: 1 }}>
      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 13 }}>
        {commit.subject}
      </Text>
      <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        <Text style={{ fontFamily: MONOSPACE }}>{commit.shortHash}</Text> · {commit.author} · {relativeDate(commit.date)}
      </Text>
    </View>
  );
}

function RepoCommitsSection({ theme, compact, repo }: { theme: PluginTheme; compact: boolean; repo: RepoCommits }) {
  const colors = useMemo(() => lanePalette(theme), [theme]);
  const head = repo.commits[0]?.hash;
  const graph = useMemo(() => {
    const rows = repo.dirty ? [{ hash: WORKTREE_ID, parents: head ? [head] : [] }, ...repo.commits] : repo.commits;
    return layoutCommits(rows);
  }, [repo.commits, repo.dirty, head]);
  const lanes = Math.max(1, Math.min(graph.laneCount, MAX_LANES));
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 } as const;
  const padding = compact ? 10 : 12;
  const offset = repo.dirty ? 1 : 0;

  return (
    <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, overflow: "hidden", backgroundColor: theme.colors.surface0 }}>
      <View style={{ padding, gap: 4, backgroundColor: theme.colors.surface1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}>{repo.name}</Text>
          {compact ? null : <Text numberOfLines={1} style={[muted, { flexShrink: 1 }]}>{repo.branch ?? "no branch"}</Text>}
          <View style={{ flex: 1 }} />
          <Text style={muted}>
            {repo.commits.length + repo.more} {repo.commits.length + repo.more === 1 ? "commit" : "commits"}
          </Text>
        </View>
        {compact ? <Text numberOfLines={1} style={muted}>{repo.branch ?? "no branch"}</Text> : null}
        <Text numberOfLines={1} style={[muted, { fontFamily: MONOSPACE, fontSize: 11 }]}>
          base {repo.base ?? "—"}{repo.mergeBase ? ` @ ${repo.mergeBase.slice(0, 10)}` : ""}
        </Text>
        {repo.error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{repo.error}</Text> : null}
      </View>
      {!repo.error && !repo.dirty && repo.commits.length === 0 ? (
        <Text style={[muted, { paddingHorizontal: padding, paddingVertical: 8 }]}>No commits since base</Text>
      ) : null}
      <View style={{ paddingHorizontal: padding - 4 }}>
        {repo.dirty ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: ROW_HEIGHT }}>
            <GraphCell row={graph.rows[0]!} lanes={lanes} colors={colors} hollow />
            <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 13, fontStyle: "italic" }}>
              Uncommitted changes
            </Text>
          </View>
        ) : null}
        {repo.commits.map((commit, index) => (
          <View key={commit.hash} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: ROW_HEIGHT }}>
            <GraphCell row={graph.rows[index + offset]!} lanes={lanes} colors={colors} hollow={false} />
            <CommitText theme={theme} commit={commit} />
          </View>
        ))}
      </View>
      {repo.more > 0 ? (
        <Text style={[muted, { paddingHorizontal: padding, paddingVertical: 8 }]}>… and {repo.more} older commits</Text>
      ) : null}
    </View>
  );
}

export function CommitsBody({ theme, compact, directory }: { theme: PluginTheme; compact: boolean; directory: string | null }) {
  const callCommits = useRpc(commitsRpc);
  const query = useQuery({
    queryKey: commitsQueryKey(directory),
    queryFn: () => callCommits({ root: directory! }),
    enabled: Boolean(directory),
  });
  if (query.isPending) return <Text style={{ color: theme.colors.foregroundMuted }}>Loading commits…</Text>;
  if (query.error) return <Text style={{ color: theme.colors.statusDanger }}>{query.error.message}</Text>;
  if (query.data.repos.length === 0) {
    return <Text style={{ color: theme.colors.foregroundMuted }}>This workspace is not inside a git repository.</Text>;
  }
  return (
    <>
      {query.data.repos.map((repo) => (
        <RepoCommitsSection key={repo.path} theme={theme} compact={compact} repo={repo} />
      ))}
    </>
  );
}
