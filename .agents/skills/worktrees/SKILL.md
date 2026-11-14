---
name: worktrees
description: Set up a task worktree, merge its PR, and remove it when finished.
---

# Task worktrees

## Create

Choose an unused sibling path and task branch. Substitute the placeholders:

```sh
git worktree list
git fetch origin main
git worktree add -b <task-branch> <worktree-path> origin/main
cd <worktree-path>
npm ci
```

Use the repository's Node version. Read the affected workspace's README and `AGENTS.md`. Keep dependencies, build output, and runtime state inside this worktree; choose separate server ports and Compose project names.

## Merge

Run the affected workspace checks, commit, push, and open a PR. Mark it ready before checking CI; draft checks cover less.

```sh
gh pr checks <pr> --watch
gh pr view <pr> --json headRefOid
```

Verify all expected checks passed on that head and review the diff. Within owner-approved scope, unless owner review is pending:

```sh
gh pr merge <pr> --squash --match-head-commit <verified-head-sha>
```

Notify Harrhy with the PR, merge commit, checks, and runtime follow-up.

## Remove

Confirm the PR merged. In the finished worktree, inspect local files:

```sh
git status --short
git ls-files --others --exclude-standard
git ls-files --others --ignored --exclude-standard
```

Check for active sessions and processes using the tree. Preserve unique ignored configuration, databases, keys, or documents; remove only confirmed rebuildable output. From another checkout:

```sh
git worktree remove <worktree-path>
```

If removal refuses, inspect the remaining files instead of forcing it.
