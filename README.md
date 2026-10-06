# paseo-nested-diff

English | [한국어](README.ko.md)

A [Paseo](https://paseo.sh) workspace panel that shows **the final diff of a workspace in one view**: the merge-base with the base branch compared against the current working tree, for the workspace repository **and every independent repository nested inside it** (separate clones or linked git worktrees, not just submodules).

However many commits a branch has, you see one result — committed, uncommitted and untracked changes together.

![Worktree Diff panel](docs/screenshot.png)

## Features

- One section per repository: the workspace repo plus nested repos up to two directories deep, each with branch, base ref, merge-base sha, total `+/-` and file count.
- File list with status (`A`, `M`, `D`, `R`, `U?` for untracked) and per-file `+/-`. Tap a file to expand its unified diff with add/delete coloring.
- Nested repositories are excluded from the parent repo's diff, so nothing is counted twice.
- Refresh button; works in narrow/phone layouts.
- **Read-only**: it only runs `git rev-parse`, `merge-base`, `diff` and `ls-files` (with `GIT_OPTIONAL_LOCKS=0`). It never writes to your repositories.

## Commits

Switch **Diff | Commits** at the top of the view to see the commits on this branch since the base, per repository (the workspace repo and each nested repo). Each repo shows a compact graph with lanes for merges, then subject, short hash, author and relative date, capped at 200 commits with an "older commits" count. If the repo has uncommitted or untracked changes, an **Uncommitted changes** row sits on top.

The commit list is read-only and not interactive: rows cannot be pressed. It is there to show the shape of the branch; the Diff view stays the place to read changes.

## How the base is chosen

For each repository separately: `origin/main` if it exists, otherwise `main`. The diff is `git merge-base HEAD <base>` → working tree. A repository with neither ref shows an error row instead of a diff.

## Requirements

- Paseo daemon and app **>= 0.10.2**
- Plugins enabled on the daemon (Settings → Plugins)
- `git` on the daemon's `PATH`

## Install

```bash
paseo plugin install github:hongmono/paseo-nested-diff
paseo plugin ls   # paseo-nested-diff should be "running"
```

Plugins are trusted, unsandboxed code — read the source before installing.

## Usage

- **Sidebar (mobile and desktop)**: open **Nested Diff** in the app sidebar and pick a worktree. Worktrees are grouped by project; ones with changes and recent activity come first. On a phone, use **‹ Worktrees** to go back; on a wide window the list and the diff sit side by side. **Wrap** wraps long lines instead of scrolling sideways.
- **Explorer tab (desktop)**: open the right-side Explorer and pick the **Nested Diff** tab, next to Files and Changes.
- **Composer button (desktop)**: click **Diff** above the message composer to open the Nested Diff tab in the Explorer.
- **Shortcut (desktop)**: press **⌘K** (Ctrl+K on Windows/Linux) and choose **Open Worktree Diff**.

## Development

```bash
npm install
npm run typecheck
npm test            # bun test/backend.ts: builds temporary repos and checks the combined diff
paseo plugin install "$PWD"
```

## License

MIT — see [LICENSE](LICENSE). Nested repository detection is adapted from [phucth102/paseo-git-graph](https://github.com/phucth102/paseo-git-graph) (MIT).
