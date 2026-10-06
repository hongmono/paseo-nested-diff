import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { Commit, DiffFile, RepoCommits, RepoDiff, commitsRpc, filePatchRpc, worktreeDiffRpc } from "../shared/diff";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_PATCH_LINES = 4000;
const MAX_COMMITS = 200;
const BASE_CANDIDATES = ["origin/main", "main"];
const NESTED_REPO_MAX_DEPTH = 2;
const NESTED_REPO_SKIP = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "venv",
  "__pycache__",
  "Pods",
]);
// Read-only by construction: never take index.lock or refresh the index stat cache.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "-M", "--ignore-submodules=none"];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER, env: GIT_ENV });
  return stdout;
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

function realPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

async function isRepoRoot(directory: string): Promise<boolean> {
  const dotGit = path.join(directory, ".git");
  try {
    const info = await stat(dotGit);
    if (info.isDirectory()) return existsSync(path.join(dotGit, "HEAD"));
    if (!info.isFile()) return false;
    const match = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, "utf8"));
    return Boolean(match?.[1] && existsSync(path.resolve(directory, match[1].trim())));
  } catch {
    return false;
  }
}

async function findNestedRepos(toplevel: string): Promise<string[]> {
  const found: string[] = [];
  let level = [""];
  for (let depth = 1; depth <= NESTED_REPO_MAX_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const parent of level) {
      let entries;
      try {
        entries = await readdir(path.join(toplevel, parent), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || NESTED_REPO_SKIP.has(entry.name)) continue;
        const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
        if (await isRepoRoot(path.join(toplevel, relativePath))) found.push(relativePath);
        else next.push(relativePath);
      }
    }
    level = next;
  }
  return found.sort();
}

interface RepoRef {
  path: string;
  name: string;
  kind: "root" | "nested";
  nested: string[];
}

async function listRepos(root: string): Promise<RepoRef[]> {
  const top = (await gitOrNull(root, ["rev-parse", "--show-toplevel"]))?.trim();
  if (!top) return [];
  const toplevel = realPath(path.resolve(top));
  const nested = await findNestedRepos(toplevel);
  return [
    { path: toplevel, name: "root", kind: "root", nested },
    ...nested.map((relative) => ({
      path: path.join(toplevel, relative),
      name: relative,
      kind: "nested" as const,
      nested: [],
    })),
  ];
}

async function resolveBase(repoPath: string): Promise<string | null> {
  for (const candidate of BASE_CANDIDATES) {
    const ok = await gitOrNull(repoPath, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (ok) return candidate;
  }
  return null;
}

function isUnder(file: string, directories: string[]): boolean {
  return directories.some((dir) => file === dir || file.startsWith(`${dir}/`));
}

function toStatus(code: string): DiffFile["status"] {
  const letter = code.charAt(0);
  switch (letter) {
    case "A":
    case "M":
    case "D":
    case "R":
    case "C":
    case "T":
    case "U":
      return letter;
    default:
      return "M";
  }
}

function parseNameStatus(raw: string): Array<{ status: DiffFile["status"]; path: string; oldPath: string | null }> {
  const fields = raw.split("\0");
  const out: Array<{ status: DiffFile["status"]; path: string; oldPath: string | null }> = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i];
    if (!code) {
      i += 1;
      continue;
    }
    const status = toStatus(code);
    if (status === "R" || status === "C") {
      out.push({ status, oldPath: fields[i + 1] ?? null, path: fields[i + 2] ?? "" });
      i += 3;
    } else {
      out.push({ status, oldPath: null, path: fields[i + 1] ?? "" });
      i += 2;
    }
  }
  return out;
}

// `--numstat -z`: "add\tdel\tpath\0", or for renames "add\tdel\t\0old\0new\0".
function parseNumstat(raw: string): Map<string, { additions: number | null; deletions: number | null }> {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (!field) continue;
    const [add, del, inlinePath] = field.split("\t");
    let file = inlinePath ?? "";
    if (file === "") {
      file = fields[i + 2] ?? "";
      i += 2;
    }
    counts.set(file, {
      additions: add === "-" ? null : Number.parseInt(add ?? "0", 10),
      deletions: del === "-" ? null : Number.parseInt(del ?? "0", 10),
    });
  }
  return counts;
}

async function countUntrackedLines(absolute: string): Promise<number | null> {
  const handle = await open(absolute, "r");
  try {
    const head = Buffer.alloc(8000);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (head.subarray(0, bytesRead).includes(0)) return null;
  } finally {
    await handle.close();
  }
  const content = await readFile(absolute);
  if (content.length === 0) return 0;
  let lines = 0;
  for (const byte of content) if (byte === 10) lines += 1;
  return content[content.length - 1] === 10 ? lines : lines + 1;
}

async function readRepoFiles(repoPath: string, mergeBase: string, excluded: string[]): Promise<DiffFile[]> {
  const [nameStatus, numstat, untracked] = await Promise.all([
    git(repoPath, ["diff", ...DIFF_FLAGS, "-z", "--name-status", mergeBase]),
    git(repoPath, ["diff", ...DIFF_FLAGS, "-z", "--numstat", mergeBase]),
    git(repoPath, ["ls-files", "-z", "--others", "--exclude-standard"]),
  ]);
  const counts = parseNumstat(numstat);
  const files: DiffFile[] = parseNameStatus(nameStatus)
    .filter((entry) => entry.path && !isUnder(entry.path, excluded))
    .map((entry) => ({
      ...entry,
      additions: counts.get(entry.path)?.additions ?? null,
      deletions: counts.get(entry.path)?.deletions ?? null,
    }));

  for (const file of untracked.split("\0")) {
    // Nested repositories show up as "dir/" entries; they are reported as their own group.
    if (!file || file.endsWith("/") || isUnder(file, excluded)) continue;
    let additions: number | null = null;
    try {
      additions = await countUntrackedLines(path.join(repoPath, file));
    } catch {
      additions = null;
    }
    files.push({ path: file, oldPath: null, status: "untracked", additions, deletions: additions === null ? null : 0 });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readRepoDiff(repo: RepoRef): Promise<RepoDiff> {
  const branchRaw = (await gitOrNull(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() ?? null;
  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : branchRaw === "HEAD" ? "(detached)" : null;
  const result: RepoDiff = {
    path: repo.path,
    name: repo.name,
    kind: repo.kind,
    branch,
    base: null,
    mergeBase: null,
    files: [],
    additions: 0,
    deletions: 0,
    error: null,
  };
  const base = await resolveBase(repo.path);
  if (!base) return { ...result, error: "No origin/main or main branch to compare against." };
  const mergeBase = (await gitOrNull(repo.path, ["merge-base", "HEAD", base]))?.trim();
  if (!mergeBase) return { ...result, base, error: `No merge-base between HEAD and ${base}.` };
  try {
    const files = await readRepoFiles(repo.path, mergeBase, repo.nested);
    return {
      ...result,
      base,
      mergeBase,
      files,
      additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
      deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    };
  } catch (error) {
    return { ...result, base, mergeBase, error: (error as Error).message };
  }
}

export async function readWorktreeDiff({
  root,
}: RpcInput<typeof worktreeDiffRpc>): Promise<RpcOutput<typeof worktreeDiffRpc>> {
  const repos = await listRepos(root);
  return { root, repos: await Promise.all(repos.map(readRepoDiff)) };
}

function truncate(patch: string): { patch: string; truncated: boolean } {
  const lines = patch.split("\n");
  if (lines.length <= MAX_PATCH_LINES) return { patch, truncated: false };
  return { patch: lines.slice(0, MAX_PATCH_LINES).join("\n"), truncated: true };
}

export async function readFilePatch({
  root,
  repoPath,
  path: file,
}: RpcInput<typeof filePatchRpc>): Promise<RpcOutput<typeof filePatchRpc>> {
  const repos = await listRepos(root);
  const repo = repos.find((candidate) => candidate.path === realPath(path.resolve(repoPath)));
  if (!repo) throw new Error(`Repository is not part of this workspace: ${repoPath}`);
  const diff = await readRepoDiff(repo);
  const entry = diff.files.find((candidate) => candidate.path === file);
  if (!entry || !diff.mergeBase) throw new Error(`No change for ${file} in ${repo.name}.`);
  const binary = entry.additions === null;

  if (entry.status === "untracked") {
    if (binary) return { patch: "", truncated: false, binary };
    try {
      await git(repo.path, ["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", entry.path]);
      return { patch: "", truncated: false, binary };
    } catch (error) {
      // `--no-index` exits 1 when the files differ, with the patch on stdout.
      const stdout = (error as { stdout?: unknown }).stdout;
      if (typeof stdout !== "string") throw error;
      return { ...truncate(stdout), binary };
    }
  }

  const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
  const patch = await git(repo.path, ["diff", ...DIFF_FLAGS, diff.mergeBase, "--", ...paths]);
  return { ...truncate(patch), binary };
}

const LOG_FORMAT = "--format=%H%x00%P%x00%an%x00%aI%x00%s%x1e";

async function isDirty(repoPath: string, excluded: string[]): Promise<boolean> {
  const status = await git(repoPath, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
  return status
    .split("\0")
    .filter((record) => record.length > 3)
    .some((record) => !isUnder(record.slice(3).replace(/\/$/, ""), excluded));
}

async function readRepoCommits(repo: RepoRef): Promise<RepoCommits> {
  const branchRaw = (await gitOrNull(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() ?? null;
  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : branchRaw === "HEAD" ? "(detached)" : null;
  const result: RepoCommits = {
    path: repo.path,
    name: repo.name,
    kind: repo.kind,
    branch,
    base: null,
    mergeBase: null,
    dirty: false,
    commits: [],
    more: 0,
    error: null,
  };
  try {
    result.dirty = await isDirty(repo.path, repo.nested);
  } catch (error) {
    return { ...result, error: (error as Error).message };
  }
  const base = await resolveBase(repo.path);
  if (!base) return { ...result, error: "No origin/main or main branch to compare against." };
  const mergeBase = (await gitOrNull(repo.path, ["merge-base", "HEAD", base]))?.trim();
  if (!mergeBase) return { ...result, base, error: `No merge-base between HEAD and ${base}.` };
  try {
    const range = `${mergeBase}..HEAD`;
    const [log, count] = await Promise.all([
      git(repo.path, ["log", "--topo-order", "--no-color", `--max-count=${MAX_COMMITS}`, LOG_FORMAT, range]),
      git(repo.path, ["rev-list", "--count", range]),
    ]);
    const parsed = log
      .split("\x1e")
      .map((record) => record.replace(/^\n/, ""))
      .filter(Boolean)
      .map((record) => {
        const [hash = "", parents = "", author = "", date = "", subject = ""] = record.split("\0");
        return { hash, parents: parents.split(" ").filter(Boolean), author, date, subject };
      });
    const inRange = new Set(parsed.map((commit) => commit.hash));
    const commits: Commit[] = parsed.map((commit) => ({
      ...commit,
      shortHash: commit.hash.slice(0, 7),
      parents: commit.parents.filter((parent) => inRange.has(parent)),
    }));
    const total = Number.parseInt(count.trim(), 10) || commits.length;
    return { ...result, base, mergeBase, commits, more: Math.max(0, total - commits.length) };
  } catch (error) {
    return { ...result, base, mergeBase, error: (error as Error).message };
  }
}

export async function readWorktreeCommits({
  root,
}: RpcInput<typeof commitsRpc>): Promise<RpcOutput<typeof commitsRpc>> {
  const repos = await listRepos(root);
  return { root, repos: await Promise.all(repos.map(readRepoCommits)) };
}
