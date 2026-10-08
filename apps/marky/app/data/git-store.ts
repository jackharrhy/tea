import { simpleGit, type SimpleGit } from "simple-git";

// `GitStore` is a thin wrapper around simple-git that keeps marky's git
// operations small, explicit, and free of side effects on the repo's
// existing config. Per-commit identity flags are passed via the
// per-call `-c user.name`/`-c user.email` arguments rather than mutating
// `.git/config` so a human contributor's local config stays untouched.

export interface GitStoreOptions {
  repoDir: string;
  authorName: string;
  authorEmail: string;
  push?: { pat: string };
}

export interface CommitResult {
  sha: string;
}

export class GitStore {
  private readonly git: SimpleGit;
  readonly repoDir: string;
  private readonly authorName: string;
  private readonly authorEmail: string;
  private readonly pushPat?: string;

  constructor(options: GitStoreOptions) {
    this.repoDir = options.repoDir;
    this.authorName = options.authorName;
    this.authorEmail = options.authorEmail;
    this.pushPat = options.push?.pat;
    this.git = simpleGit({ baseDir: this.repoDir });
  }

  async assertRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      throw new Error(`${this.repoDir} is not a git repository`);
    }
  }

  async stageEdit(args: { path: string }): Promise<void> {
    await this.git.add([args.path]);
  }

  async stageRename(args: { oldPath: string; newPath: string }): Promise<void> {
    // Use `git mv` when the source is still on disk (it moves the file
    // and stages the rename in one shot). If ContentStore.rename has
    // already moved the file, `git mv` fails, so fall back to staging
    // the new path with `git add` and the old path with `git rm`. The
    // resulting diff shows as a rename when git's similarity detection
    // runs (-M).
    try {
      await this.git.mv(args.oldPath, args.newPath);
    } catch {
      await this.git.add([args.newPath]);
      await this.git.rm([args.oldPath]);
    }
  }

  async stageDelete(args: { path: string }): Promise<void> {
    // `git rm` here also removes the on-disk file. ContentStore.remove
    // may have already done so; pass --ignore-unmatch to be defensive
    // against the file being gone or untracked.
    await this.git.raw(["rm", "-f", "--ignore-unmatch", "--", args.path]);
  }

  async commit(message: string): Promise<CommitResult | null> {
    // Look at the staged index only. Unstaged edits in the working tree
    // do not produce a commit even though we're using `git commit` (no
    // `-a`). If nothing is staged, simple-git returns a commit object
    // with empty `commit` and `summary.changes === 0`; treat that as
    // "nothing to commit" and return null.
    //
    // We have to set BOTH author and committer identity. --author covers
    // the author field but git also needs user.name / user.email for the
    // committer, otherwise it fails with "Please tell me who you are."
    // when no global git config exists (e.g. inside the production
    // container). Use per-call `-c` flags so we don't mutate .git/config.
    const result = await this.git
      .env({
        GIT_AUTHOR_NAME: this.authorName,
        GIT_AUTHOR_EMAIL: this.authorEmail,
        GIT_COMMITTER_NAME: this.authorName,
        GIT_COMMITTER_EMAIL: this.authorEmail,
      })
      .commit(message);
    if (!result.commit) return null;
    return { sha: result.commit };
  }

  async hasUnpushed(): Promise<boolean> {
    // `git rev-list --count @{u}..HEAD` returns the number of commits
    // ahead of the upstream. If there is no upstream configured the
    // command errors; treat that as "has unpushed" so a first push will
    // happen when configured.
    try {
      const count = await this.git.raw(["rev-list", "--count", "@{u}..HEAD"]);
      return Number.parseInt(count.trim(), 10) > 0;
    } catch {
      return true;
    }
  }

  async push(): Promise<void> {
    // If a PAT is provided, inject it into the origin URL for the
    // duration of this single push. Never write the credential back to
    // the repo config or remote URL.
    if (!this.pushPat) {
      await this.git.push();
      return;
    }

    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (!origin) {
      throw new Error("GitStore.push: no origin remote configured");
    }
    const authenticatedUrl = injectPat(
      origin.refs.push || origin.refs.fetch,
      this.pushPat,
    );
    if (!authenticatedUrl) {
      // Non-HTTPS origin (likely SSH); fall through to plain push.
      await this.git.push();
      return;
    }
    await this.git.push(authenticatedUrl, "HEAD");
  }
}

function injectPat(url: string, pat: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    u.username = "x-access-token";
    u.password = pat;
    return u.toString();
  } catch {
    return null;
  }
}
