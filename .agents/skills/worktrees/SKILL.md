---
name: worktrees
description: Create, use, integrate, and safely remove independent task worktrees in this repository.
---

# Task worktrees

Follow the root `AGENTS.md` parallel task policy. Git records worktrees and branches; GitHub records PRs and checks. No separate inventory database, permission registry, lock, or coordinator approval is needed.

## Discover and create

Inspect the current checkout and shared repository before choosing a unique task branch and an unused worktree path:

```sh
git rev-parse --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git worktree list --porcelain -z
git fetch origin main
git worktree add -b <task-branch> <new-worktree-path> origin/main
```

Replace angle-bracket placeholders before running commands. Parse porcelain output as NUL-delimited data when scripting. Do not assume `.git` is a directory, reuse another task's checkout, or override Git's branch-checkout safeguards. The shared main checkout is not an editing hub.

## Bootstrap and work

- Read the new checkout's root and affected workspace guidance. Use its prescribed toolchain and install dependencies there (`npm ci` for this repository).
- Keep writable dependencies, generated output, caches, databases, and test state separate. Use distinct server ports and Compose project names. Do not copy ignored credentials or private state as a bootstrap shortcut.
- Work independently within the owner-authorized task. Retry ordinary Git races after inspecting the result; update or rebase for actual conflicts, integration validation, or GitHub requirements, then rerun affected checks. No broad build lock or source reservation.

## Integrate and report

Open a PR and review its diff. Mark it ready before final validation: draft checks may cover less. Run applicable local checks and verify all expected hosted workflows completed successfully on the exact current PR head, not merely the required-check subset. Recheck the head before merging; use an exact-head merge guard when available.

Self-merge within approved scope unless the owner requested a review checkpoint. For a real unresolved product, security, or destructive choice, send Familiar the PR link and specific decision needed. After merging, notify Harrhy with the PR, merge commit, check evidence, and any runtime follow-up. Notification is not a permission request; shared-runtime operator coordination does not gate source work.

## Remove finished work safely

1. Verify the work is merged or otherwise preserved. Squash merges need PR or patch/tree evidence; ancestry alone may not establish this.
2. Inspect tracked changes, untracked files, and ignored files in the candidate worktree:

   ```sh
   git status --short
   git ls-files --others --exclude-standard
   git ls-files --others --ignored --exclude-standard
   ```

3. Check actual active sessions and task-owned processes before removal. Stop only your own task's processes. Classify ignored files: dependencies may be rebuildable; private configuration, databases, keys, and local documents may be unique. Preserve unique state deliberately before removing the tree; do not print secrets or make blanket backup copies.
4. From another checkout, run `git worktree remove <finished-worktree-path>`. If removal refuses, inspect why. Do not bypass unknown state with force, `git clean -fdx`, or recursive deletion. Retaining a branch is fine; squash history is not a reason for automatic forced branch deletion.

## Optional helpers

Built-in Git is sufficient. [Worktrunk](https://worktrunk.dev/) can simplify creation, switching, listing, and removal, but installation and setup hooks are optional; review hooks before trusting or running them. Its local `wt merge` workflow is not a substitute for this repository's hosted PR checks and merge policy.

Use external local configuration for placement preferences only if useful. Any common-directory JSON hints must be untracked and nonauthoritative, never an ownership lease or merge gate. No SQLite store is needed. Keep host paths, identities, secrets, and private inventories out of tracked guidance.

References: [git worktree](https://git-scm.com/docs/git-worktree), [git rev-parse](https://git-scm.com/docs/git-rev-parse).
