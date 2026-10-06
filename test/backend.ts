import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from the developer's git config (hooks, signing, default branch) for both the fixture and the plugin.
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "test@example.com";

const { readFilePatch, readWorktreeCommits, readWorktreeDiff } = await import("../server/diff");
const { layoutCommits } = await import("../client/graph-layout");
// Evaluates defineRpc, which validates RPC names the same way the daemon does at load.
await import("../shared/diff");

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function initRepo(dir: string) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
}

function commit(dir: string, message: string) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

const temp = mkdtempSync(path.join(os.tmpdir(), "nested-diff-test-"));
try {
  const root = path.join(temp, "workspace");

  // Root repo: three commits on a feature branch, then an uncommitted edit and an untracked file.
  initRepo(root);
  write(path.join(root, "README.md"), "# Demo\nold line\n");
  write(path.join(root, "old.txt"), "one\ntwo\n");
  commit(root, "base");
  git(root, "checkout", "-q", "-b", "feature");
  write(path.join(root, "docs/guide.md"), "a\nb\nc\n");
  commit(root, "add guide");
  write(path.join(root, "README.md"), "# Demo\nnew line\n");
  commit(root, "edit readme");
  unlinkSync(path.join(root, "old.txt"));
  commit(root, "remove old");
  git(root, "checkout", "-q", "-b", "topic", "HEAD~2");
  write(path.join(root, "topic.txt"), "side\n");
  commit(root, "topic work");
  git(root, "checkout", "-q", "feature");
  git(root, "merge", "-q", "--no-ff", "-m", "merge topic", "topic");
  write(path.join(root, "docs/guide.md"), "a\nb\nc\nd\n");
  write(path.join(root, "notes.txt"), "todo\nlater\n");

  // Nested independent repo: a rename on the feature branch; origin/main must win over a diverged local main.
  const svcA = path.join(root, "svc-a");
  initRepo(svcA);
  write(path.join(svcA, "src/x.ts"), "export const x = 1;\nexport const y = 2;\nexport const z = 3;\n");
  commit(svcA, "base");
  git(svcA, "update-ref", "refs/remotes/origin/main", "HEAD");
  write(path.join(svcA, "main-only.txt"), "only on local main\n");
  commit(svcA, "local main moves on");
  git(svcA, "checkout", "-q", "-b", "feature", "origin/main");
  git(svcA, "mv", "src/x.ts", "src/y.ts");
  commit(svcA, "rename");

  // Nested repo two levels down, checked out as a linked worktree (its .git is a file) with no changes.
  const upstreamB = path.join(temp, "svc-b-upstream");
  initRepo(upstreamB);
  write(path.join(upstreamB, "index.js"), "module.exports = 1;\n");
  commit(upstreamB, "base");
  git(upstreamB, "worktree", "add", "-q", "-b", "feature", path.join(root, "libs/svc-b"));

  const statusBefore = [root, svcA, path.join(root, "libs/svc-b")].map((dir) => git(dir, "status", "--porcelain", "-uall"));
  const { repos } = await readWorktreeDiff({ root });
  check("discovers root and both nested repos", repos.map((repo) => repo.name).join(",") === "root,libs/svc-b,svc-a", repos.map((repo) => repo.name).join(","));

  const rootDiff = repos.find((repo) => repo.name === "root")!;
  const byPath = new Map(rootDiff.files.map((file) => [file.path, file]));
  check("root base and branch", rootDiff.base === "main" && rootDiff.branch === "feature" && rootDiff.error === null, `${rootDiff.base} ${rootDiff.branch} ${rootDiff.error}`);
  check("root collapses commits + uncommitted into one result", rootDiff.files.length === 5 && rootDiff.additions === 8 && rootDiff.deletions === 3, `files=${rootDiff.files.length} +${rootDiff.additions} -${rootDiff.deletions}`);
  check("committed then edited file", byPath.get("docs/guide.md")?.status === "A" && byPath.get("docs/guide.md")?.additions === 4, JSON.stringify(byPath.get("docs/guide.md")));
  check("modified file", byPath.get("README.md")?.status === "M" && byPath.get("README.md")?.additions === 1 && byPath.get("README.md")?.deletions === 1);
  check("deleted file", byPath.get("old.txt")?.status === "D" && byPath.get("old.txt")?.deletions === 2);
  check("untracked file", byPath.get("notes.txt")?.status === "untracked" && byPath.get("notes.txt")?.additions === 2);
  check("merged side-branch file", byPath.get("topic.txt")?.status === "A" && byPath.get("topic.txt")?.additions === 1);
  check("nested repos excluded from root", !rootDiff.files.some((file) => file.path.startsWith("svc-a") || file.path.startsWith("libs/")));

  const svcADiff = repos.find((repo) => repo.name === "svc-a")!;
  const renamed = svcADiff.files[0];
  check("origin/main preferred over main", svcADiff.base === "origin/main", `${svcADiff.base}`);
  check("rename detected", svcADiff.files.length === 1 && renamed?.status === "R" && renamed.oldPath === "src/x.ts" && renamed.path === "src/y.ts", JSON.stringify(svcADiff.files));

  const svcBDiff = repos.find((repo) => repo.name === "libs/svc-b")!;
  check("linked worktree with no changes", svcBDiff.error === null && svcBDiff.files.length === 0 && svcBDiff.branch === "feature", JSON.stringify(svcBDiff));

  const readmePatch = await readFilePatch({ root, repoPath: rootDiff.path, path: "README.md" });
  check("tracked patch", readmePatch.patch.includes("-old line") && readmePatch.patch.includes("+new line"));
  const untrackedPatch = await readFilePatch({ root, repoPath: rootDiff.path, path: "notes.txt" });
  check("untracked patch", untrackedPatch.patch.includes("+todo") && untrackedPatch.patch.includes("+later"));
  const renamePatch = await readFilePatch({ root, repoPath: svcADiff.path, path: "src/y.ts" });
  check("rename patch", renamePatch.patch.includes("rename from src/x.ts"));

  let rejected = false;
  try {
    await readFilePatch({ root, repoPath: upstreamB, path: "index.js" });
  } catch {
    rejected = true;
  }
  check("repository outside the workspace rejected", rejected);

  const { repos: commitRepos } = await readWorktreeCommits({ root });
  const rootCommits = commitRepos.find((repo) => repo.name === "root")!;
  const subjects = rootCommits.commits.map((c) => c.subject);
  check("root commits since base", rootCommits.error === null && rootCommits.commits.length === 5 && rootCommits.more === 0, subjects.join(" | "));
  check("topo order: merge first", subjects[0] === "merge topic");
  check("all branch commits listed", ["add guide", "edit readme", "remove old", "topic work"].every((s) => subjects.includes(s)));
  const merge = rootCommits.commits[0]!;
  check("merge keeps both in-range parents", merge.parents.length === 2 && merge.parents.every((p) => rootCommits.commits.some((c) => c.hash === p)));
  const oldest = rootCommits.commits.find((c) => c.subject === "add guide")!;
  check("parents outside the range are dropped", oldest.parents.length === 0);
  check("commit fields", merge.shortHash === merge.hash.slice(0, 7) && merge.author === "test" && !Number.isNaN(Date.parse(merge.date)));
  check("root dirty (uncommitted + untracked)", rootCommits.dirty === true);
  const svcACommits = commitRepos.find((repo) => repo.name === "svc-a")!;
  check("nested repo commits", svcACommits.commits.length === 1 && svcACommits.commits[0]!.subject === "rename" && svcACommits.base === "origin/main", JSON.stringify(svcACommits.commits.map((c) => c.subject)));
  check("nested repo clean", svcACommits.dirty === false);
  const svcBCommits = commitRepos.find((repo) => repo.name === "libs/svc-b")!;
  check("no commits since base", svcBCommits.error === null && svcBCommits.commits.length === 0 && svcBCommits.dirty === false);
  const graph = layoutCommits([{ hash: "__worktree__", parents: [merge.hash] }, ...rootCommits.commits]);
  check("graph: merge opens a second lane", graph.laneCount === 2 && graph.rows[1]!.isMerge, `lanes=${graph.laneCount}`);

  const statusAfter = [root, svcA, path.join(root, "libs/svc-b")].map((dir) => git(dir, "status", "--porcelain", "-uall"));
  check("read-only: git status unchanged", statusBefore.join() === statusAfter.join());
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
