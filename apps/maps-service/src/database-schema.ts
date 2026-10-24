import { DatabaseSync } from "node:sqlite";

export function initializeMapsDatabase(sql: DatabaseSync): void {
  sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, fourm_sub TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
        display_name TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automation_grants (
        code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automation_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_transactions (
        state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, return_to TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, game TEXT NOT NULL CHECK(game IN ('quake','goldsrc','gower')),
        created_by TEXT NOT NULL REFERENCES users(id), archived_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),
        PRIMARY KEY(project_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL,
        created_at INTEGER NOT NULL, UNIQUE(user_id, parent_id, name)
      );
      CREATE TABLE IF NOT EXISTS folder_projects (
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        PRIMARY KEY(folder_id, project_id)
      );
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('valve-220','quake')),
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(project_id, name)
      );
      CREATE TABLE IF NOT EXISTS resource_mounts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL, provider TEXT NOT NULL, provider_asset_id TEXT NOT NULL,
        expected_sha256 TEXT NOT NULL, kind TEXT NOT NULL, display_name TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL, UNIQUE(project_id, ordinal)
      );
      CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        requested_by TEXT NOT NULL REFERENCES users(id), map_version INTEGER NOT NULL,
        profile_id TEXT NOT NULL, quality TEXT NOT NULL CHECK(quality IN ('preview','final')),
        status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
        source_sha256 TEXT, result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS project_members_by_user
        ON project_members(user_id, project_id);
      CREATE INDEX IF NOT EXISTS builds_by_map_created
        ON builds(map_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS builds_by_requester_status
        ON builds(requested_by, status);
      CREATE INDEX IF NOT EXISTS builds_by_requester_created
        ON builds(requested_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS builds_by_status
        ON builds(status);
    `);
  const projectTable = sql
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'",
    )
    .get() as { sql: string };
  if (!projectTable.sql.includes("'gower'")) {
    sql.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      sql.exec(`
          CREATE TABLE projects_new (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            game TEXT NOT NULL CHECK(game IN ('quake','goldsrc','gower')),
            created_by TEXT NOT NULL REFERENCES users(id), archived_at INTEGER,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          INSERT INTO projects_new SELECT * FROM projects;
          DROP TABLE projects;
          ALTER TABLE projects_new RENAME TO projects;
          COMMIT;
        `);
    } catch (error) {
      sql.exec("ROLLBACK;");
      throw error;
    } finally {
      sql.exec("PRAGMA foreign_keys = ON;");
    }
    const violation = sql.prepare("PRAGMA foreign_key_check").get();
    if (violation) throw new Error("Project migration left broken references");
  }
  sql
    .prepare(
      "UPDATE builds SET status='failed',result_json=?,updated_at=? WHERE status IN ('queued','running')",
    )
    .run(
      JSON.stringify({ error: "Build interrupted by service restart" }),
      Date.now(),
    );
}
