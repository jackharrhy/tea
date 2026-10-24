import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  HostedBuildResultSchema,
  type HostedBuild as HostedBuildRecord,
  type HostedProjectAccessUser as ProjectAccessUser,
  type HostedProjectMap as HostedMapSummary,
  type HostedProjectSummary as ProjectSummary,
  type HostedGame,
  type HostedResourceMount,
  type ProjectRole as ProtocolProjectRole,
} from "@tea/maps-protocol";
import { z } from "zod";
import { createHostedId, hostedSlug, isHostedId } from "./hosted-identity.js";
import { initializeMapsDatabase } from "./database-schema.js";
import {
  MAX_PROJECT_ASSET_BYTES,
  MAX_RESOURCE_FILE_BYTES,
} from "./resource-limits.js";

export type ProjectRole = ProtocolProjectRole;
export type {
  HostedBuildRecord,
  HostedMapSummary,
  ProjectAccessUser,
  ProjectSummary,
};

export interface MapsUser {
  readonly id: string;
  readonly fourmSub: string;
  readonly username: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
}
interface SqlBuild {
  id: string;
  map_version: number;
  profile_id: string;
  quality: "preview" | "final";
  status: HostedBuildRecord["status"];
  source_sha256: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
}

function hostedBuild(row: SqlBuild): HostedBuildRecord {
  return {
    id: row.id,
    mapVersion: row.map_version,
    profileId: row.profile_id,
    quality: row.quality,
    status: row.status,
    sourceSha256: row.source_sha256,
    result: row.result_json
      ? HostedBuildResultSchema.parse(JSON.parse(row.result_json))
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SqlUser {
  id: string;
  fourm_sub: string;
  username: string;
  display_name: string;
  is_admin: number;
}

interface SqlResourceMount {
  readonly id: string;
  readonly ordinal: number;
  readonly provider: "artbin" | "upload" | "maps";
  readonly provider_asset_id: string;
  readonly expected_sha256: string;
  readonly kind: string;
  readonly display_name: string;
  readonly metadata_json: string;
  readonly created_at: number;
}

const ResourceMetadataSchema = z.record(z.string(), z.unknown());

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

export class MapsDatabase {
  private readonly sql: DatabaseSync;

  public constructor(
    path: string,
    private readonly createPublicId: () => string = createHostedId,
  ) {
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    initializeMapsDatabase(this.sql);
  }

  public close(): void {
    this.sql.close();
  }

  public beginOauth(
    returnTo: string,
    verifier: string,
  ): { state: string; expiresAt: number } {
    const state = token();
    const expiresAt = Date.now() + 10 * 60_000;
    this.sql
      .prepare(
        "INSERT INTO oauth_transactions(state_hash,verifier,return_to,expires_at) VALUES (?,?,?,?)",
      )
      .run(digest(state), verifier, returnTo, expiresAt);
    return { state, expiresAt };
  }

  public consumeOauth(
    state: string,
  ): { verifier: string; returnTo: string } | null {
    const row = this.sql
      .prepare(
        "DELETE FROM oauth_transactions WHERE state_hash = ? AND expires_at > ? RETURNING verifier, return_to",
      )
      .get(digest(state), Date.now()) as
      | { verifier: string; return_to: string }
      | undefined;
    return row ? { verifier: row.verifier, returnTo: row.return_to } : null;
  }

  public upsertUser(profile: Omit<MapsUser, "id">): MapsUser {
    const now = Date.now();
    const existing = this.sql
      .prepare("SELECT id FROM users WHERE fourm_sub = ?")
      .get(profile.fourmSub) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    this.sql
      .prepare(`
      INSERT INTO users(id, fourm_sub, username, display_name, is_admin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fourm_sub) DO UPDATE SET username=excluded.username,
      display_name=excluded.display_name, is_admin=excluded.is_admin, updated_at=excluded.updated_at
    `)
      .run(
        id,
        profile.fourmSub,
        profile.username,
        profile.displayName,
        profile.isAdmin ? 1 : 0,
        now,
        now,
      );
    return { id, ...profile };
  }

  public createSession(userId: string): { token: string; expiresAt: number } {
    const value = token();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60_000;
    this.sql
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
      )
      .run(digest(value), userId, expiresAt, Date.now());
    return { token: value, expiresAt };
  }

  public sessionUser(value: string | undefined): MapsUser | null {
    if (!value) return null;
    const row = this.sql
      .prepare(`
      SELECT u.id, u.fourm_sub, u.username, u.display_name, u.is_admin
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?
    `)
      .get(digest(value), Date.now()) as SqlUser | undefined;
    return row ? this.user(row) : null;
  }

  public deleteSession(value: string | undefined): void {
    if (value)
      this.sql
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(digest(value));
  }

  public createAutomationGrant(
    userId: string,
    projectId: string,
  ): { code: string; expiresAt: number } | null {
    if (
      !this.role(projectId, userId) ||
      this.role(projectId, userId) === "viewer"
    )
      return null;
    const code = token();
    const expiresAt = Date.now() + 10 * 60_000;
    this.sql
      .prepare(
        "INSERT INTO automation_grants(code_hash,user_id,project_id,expires_at,created_at) VALUES (?,?,?,?,?)",
      )
      .run(digest(code), userId, projectId, expiresAt, Date.now());
    return { code, expiresAt };
  }

  public redeemAutomationGrant(
    code: string,
  ): { token: string; expiresAt: number; projectId: string } | null {
    const grant = this.sql
      .prepare(
        "DELETE FROM automation_grants WHERE code_hash=? AND expires_at>? RETURNING user_id,project_id",
      )
      .get(digest(code), Date.now()) as
      | { user_id: string; project_id: string }
      | undefined;
    if (
      !grant ||
      !this.role(grant.project_id, grant.user_id) ||
      this.role(grant.project_id, grant.user_id) === "viewer"
    )
      return null;
    const value = token();
    const expiresAt = Date.now() + 60 * 60_000;
    this.sql
      .prepare(
        "INSERT INTO automation_sessions(token_hash,user_id,project_id,expires_at,created_at) VALUES (?,?,?,?,?)",
      )
      .run(
        digest(value),
        grant.user_id,
        grant.project_id,
        expiresAt,
        Date.now(),
      );
    return { token: value, expiresAt, projectId: grant.project_id };
  }

  public automationSession(
    value: string | undefined,
  ): { user: MapsUser; projectId: string } | null {
    if (!value) return null;
    const row = this.sql
      .prepare(`SELECT u.id,u.fourm_sub,u.username,u.display_name,u.is_admin,s.project_id
      FROM automation_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`)
      .get(digest(value), Date.now()) as
      | (SqlUser & { project_id: string })
      | undefined;
    if (
      !row ||
      !this.role(row.project_id, row.id) ||
      this.role(row.project_id, row.id) === "viewer"
    )
      return null;
    return { user: this.user(row), projectId: row.project_id };
  }

  private user(row: SqlUser): MapsUser {
    return {
      id: row.id,
      fourmSub: row.fourm_sub,
      username: row.username,
      displayName: row.display_name,
      isAdmin: row.is_admin === 1,
    };
  }

  private availableHostedId(table: "projects" | "maps"): string {
    const query =
      table === "projects"
        ? this.sql.prepare("SELECT 1 FROM projects WHERE id=?")
        : this.sql.prepare("SELECT 1 FROM maps WHERE id=?");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = this.createPublicId();
      if (!query.get(id)) return id;
    }
    throw new Error(`Could not allocate a unique ${table} ID`);
  }

  public createProject(
    userId: string,
    name: string,
    game: HostedGame,
  ): ProjectSummary {
    const now = Date.now();
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const id = this.availableHostedId("projects");
      this.sql
        .prepare(`INSERT INTO projects(
          id,name,game,created_by,archived_at,created_at,updated_at
        ) VALUES(?,?,?,?,NULL,?,?)`)
        .run(id, name, game, userId, now, now);
      this.sql
        .prepare(
          "INSERT INTO project_members(project_id,user_id,role) VALUES (?,?,'owner')",
        )
        .run(id, userId);
      this.sql.exec("COMMIT");
      return {
        id,
        slug: hostedSlug(name, "project"),
        name,
        game,
        role: "owner",
        updatedAt: now,
      };
    } catch (error) {
      this.sql.exec("ROLLBACK");
      throw error;
    }
  }

  public listProjects(userId: string): readonly ProjectSummary[] {
    const rows = this.sql
      .prepare(`
      SELECT p.id, p.name, p.game, p.updated_at, m.role FROM projects p
      JOIN project_members m ON m.project_id=p.id
      WHERE m.user_id=? AND p.archived_at IS NULL ORDER BY p.updated_at DESC
    `)
      .all(userId) as {
      id: string;
      name: string;
      game: HostedGame;
      updated_at: number;
      role: ProjectRole;
    }[];
    return rows.map((row) => ({
      id: row.id,
      slug: hostedSlug(row.name, "project"),
      name: row.name,
      game: row.game,
      role: row.role,
      updatedAt: row.updated_at,
    }));
  }

  public role(projectId: string, userId: string): ProjectRole | null {
    const row = this.sql
      .prepare(
        "SELECT role FROM project_members WHERE project_id=? AND user_id=?",
      )
      .get(projectId, userId) as { role: ProjectRole } | undefined;
    return row?.role ?? null;
  }

  public listProjectAccess(
    projectId: string,
    ownerId: string,
  ): readonly ProjectAccessUser[] | null {
    if (this.role(projectId, ownerId) !== "owner") return null;
    const rows = this.sql
      .prepare(`
      SELECT u.id,u.username,u.display_name,pm.role
      FROM users u
      LEFT JOIN project_members pm ON pm.user_id=u.id AND pm.project_id=?
      ORDER BY CASE WHEN pm.role='owner' THEN 0 WHEN pm.role IS NOT NULL THEN 1 ELSE 2 END,
        u.username COLLATE NOCASE
    `)
      .all(projectId) as {
      id: string;
      username: string;
      display_name: string;
      role: ProjectRole | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    }));
  }

  public setProjectMemberRole(
    projectId: string,
    ownerId: string,
    userId: string,
    role: Exclude<ProjectRole, "owner">,
  ): boolean {
    if (this.role(projectId, ownerId) !== "owner") return false;
    const target = this.sql
      .prepare("SELECT id FROM users WHERE id=?")
      .get(userId);
    if (!target || this.role(projectId, userId) === "owner") return false;
    this.sql
      .prepare(`INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?)
      ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role`)
      .run(projectId, userId, role);
    return true;
  }

  public removeProjectMember(
    projectId: string,
    ownerId: string,
    userId: string,
  ): boolean {
    if (this.role(projectId, ownerId) !== "owner") return false;
    const result = this.sql
      .prepare(
        "DELETE FROM project_members WHERE project_id=? AND user_id=? AND role!='owner'",
      )
      .run(projectId, userId);
    return result.changes === 1;
  }

  public project(
    projectId: string,
    userId: string,
  ): (ProjectSummary & { maps: readonly HostedMapSummary[] }) | null {
    const role = this.role(projectId, userId);
    if (!role) return null;
    const row = this.sql
      .prepare(
        "SELECT id,name,game,updated_at FROM projects WHERE id=? AND archived_at IS NULL",
      )
      .get(projectId) as
      | { id: string; name: string; game: HostedGame; updated_at: number }
      | undefined;
    if (!row) return null;
    const maps = this.sql
      .prepare(
        "SELECT id,name,format,updated_at FROM maps WHERE project_id=? ORDER BY name",
      )
      .all(projectId) as {
      id: string;
      name: string;
      format: "valve-220" | "quake";
      updated_at: number;
    }[];
    return {
      id: row.id,
      slug: hostedSlug(row.name, "project"),
      name: row.name,
      game: row.game,
      role,
      updatedAt: row.updated_at,
      maps: maps.map((map) => ({
        id: map.id,
        slug: hostedSlug(map.name, "map"),
        name: map.name,
        format: map.format,
        updatedAt: map.updated_at,
      })),
    };
  }

  public createMapId(): string {
    return this.availableHostedId("maps");
  }

  public hasMapNamed(projectId: string, name: string): boolean {
    return Boolean(
      this.sql
        .prepare("SELECT 1 FROM maps WHERE project_id=? AND name=?")
        .get(projectId, name),
    );
  }

  public createMap(input: {
    id: string;
    projectId: string;
    userId: string;
    name: string;
    format: "valve-220" | "quake";
  }): HostedMapSummary {
    if (!isHostedId(input.id))
      throw new Error("Map ID does not satisfy the hosted ID contract");
    const now = Date.now();
    this.sql
      .prepare(`INSERT INTO maps(id,project_id,name,format,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`)
      .run(
        input.id,
        input.projectId,
        input.name,
        input.format,
        input.userId,
        now,
        now,
      );
    this.sql
      .prepare("UPDATE projects SET updated_at=? WHERE id=?")
      .run(now, input.projectId);
    return {
      id: input.id,
      slug: hostedSlug(input.name, "map"),
      name: input.name,
      format: input.format,
      updatedAt: now,
    };
  }

  public map(
    mapId: string,
    userId: string,
  ): {
    readonly id: string;
    readonly slug: string;
    readonly projectId: string;
    readonly projectSlug: string;
    readonly projectName: string;
    readonly game: HostedGame;
    readonly name: string;
    readonly format: "valve-220" | "quake";
    readonly role: ProjectRole;
  } | null {
    const row = this.sql
      .prepare(`
      SELECT m.id,m.project_id,m.name,m.format,
        p.name AS project_name,p.game,pm.role
      FROM maps m JOIN projects p ON p.id=m.project_id
      JOIN project_members pm ON pm.project_id=p.id
      WHERE m.id=? AND pm.user_id=? AND p.archived_at IS NULL
    `)
      .get(mapId, userId) as
      | {
          id: string;
          project_id: string;
          name: string;
          format: "valve-220" | "quake";
          project_name: string;
          game: HostedGame;
          role: ProjectRole;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          slug: hostedSlug(row.name, "map"),
          projectId: row.project_id,
          projectSlug: hostedSlug(row.project_name, "project"),
          projectName: row.project_name,
          game: row.game,
          name: row.name,
          format: row.format,
          role: row.role,
        }
      : null;
  }

  public listResourceMounts(
    projectId: string,
    userId: string,
  ): readonly HostedResourceMount[] | null {
    if (!this.role(projectId, userId)) return null;
    return this.listResourceMountsForProject(projectId);
  }

  public listResourceMountsForProject(
    projectId: string,
  ): readonly HostedResourceMount[] {
    const rows = this.sql
      .prepare(`SELECT id,ordinal,provider,provider_asset_id,expected_sha256,kind,display_name,metadata_json,created_at
      FROM resource_mounts WHERE project_id=? ORDER BY ordinal`)
      .all(projectId) as unknown as SqlResourceMount[];
    return rows.map((row) => ({
      id: row.id,
      ordinal: row.ordinal,
      provider: row.provider,
      providerAssetId: row.provider_asset_id,
      expectedSha256: row.expected_sha256,
      kind: row.kind,
      displayName: row.display_name,
      size: Number(
        ResourceMetadataSchema.parse(JSON.parse(row.metadata_json)).size ?? 0,
      ),
      createdAt: row.created_at,
    }));
  }

  public projectAssetBytes(projectId: string): number {
    const mounts = this.listResourceMountsForProject(projectId);
    const unique = new Map(
      mounts.map((mount) => [mount.expectedSha256, mount.size]),
    );
    return [...unique.values()].reduce((sum, size) => sum + size, 0);
  }

  public createResourceMount(input: {
    projectId: string;
    userId: string;
    provider: "artbin" | "upload" | "maps";
    providerAssetId: string;
    expectedSha256: string;
    kind: string;
    displayName: string;
    size: number;
    metadata: unknown;
  }): HostedResourceMount | null {
    const role = this.role(input.projectId, input.userId);
    if (role !== "owner") return null;
    if (
      !Number.isSafeInteger(input.size) ||
      input.size < 0 ||
      input.size > MAX_RESOURCE_FILE_BYTES
    )
      throw Object.assign(
        new Error("Project assets must be at most 512 MiB per file"),
        {
          status: 413,
        },
      );
    const existing = this.sql
      .prepare(
        "SELECT 1 FROM resource_mounts WHERE project_id=? AND expected_sha256=? LIMIT 1",
      )
      .get(input.projectId, input.expectedSha256);
    if (
      !existing &&
      this.projectAssetBytes(input.projectId) + input.size >
        MAX_PROJECT_ASSET_BYTES
    )
      throw Object.assign(new Error("Project assets exceed the 1 GiB quota"), {
        status: 413,
      });
    const id = randomUUID();
    const ordinal = (
      this.sql
        .prepare(
          "SELECT COALESCE(MAX(ordinal),-1)+1 AS value FROM resource_mounts WHERE project_id=?",
        )
        .get(input.projectId) as { value: number }
    ).value;
    const createdAt = Date.now();
    this.sql
      .prepare(`INSERT INTO resource_mounts(
        id,project_id,ordinal,provider,provider_asset_id,expected_sha256,kind,display_name,
        metadata_json,created_by,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        input.projectId,
        ordinal,
        input.provider,
        input.providerAssetId,
        input.expectedSha256,
        input.kind,
        input.displayName,
        JSON.stringify({
          ...ResourceMetadataSchema.parse(input.metadata),
          size: input.size,
        }),
        input.userId,
        createdAt,
      );
    return {
      id,
      ordinal,
      provider: input.provider,
      providerAssetId: input.providerAssetId,
      expectedSha256: input.expectedSha256,
      kind: input.kind,
      displayName: input.displayName,
      size: input.size,
      createdAt,
    };
  }

  public resourceMount(
    projectId: string,
    mountId: string,
    userId: string,
  ): {
    expectedSha256: string;
    kind: string;
    displayName: string;
    metadata: Record<string, unknown>;
  } | null {
    if (!this.role(projectId, userId)) return null;
    return this.resourceMountForProject(projectId, mountId);
  }

  public deleteResourceMount(
    projectId: string,
    mountId: string,
    userId: string,
  ): boolean {
    if (this.role(projectId, userId) !== "owner") return false;
    const result = this.sql
      .prepare("DELETE FROM resource_mounts WHERE project_id=? AND id=?")
      .run(projectId, mountId);
    return result.changes > 0;
  }

  public resourceMountForProject(
    projectId: string,
    mountId: string,
  ): {
    expectedSha256: string;
    kind: string;
    displayName: string;
    metadata: Record<string, unknown>;
  } | null {
    const row = this.sql
      .prepare(
        "SELECT expected_sha256,kind,display_name,metadata_json FROM resource_mounts WHERE project_id=? AND id=?",
      )
      .get(projectId, mountId) as
      | {
          expected_sha256: string;
          kind: string;
          display_name: string;
          metadata_json: string;
        }
      | undefined;
    return row
      ? {
          expectedSha256: row.expected_sha256,
          kind: row.kind,
          displayName: row.display_name,
          metadata: ResourceMetadataSchema.parse(JSON.parse(row.metadata_json)),
        }
      : null;
  }

  public createBuild(input: {
    mapId: string;
    userId: string;
    mapVersion: number;
    profileId: string;
    quality: "preview" | "final";
  }): HostedBuildRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.sql
      .prepare(`INSERT INTO builds(id,map_id,requested_by,map_version,profile_id,quality,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'queued',?,?)`)
      .run(
        id,
        input.mapId,
        input.userId,
        input.mapVersion,
        input.profileId,
        input.quality,
        createdAt,
        createdAt,
      );
    return {
      id,
      mapVersion: input.mapVersion,
      profileId: input.profileId,
      quality: input.quality,
      status: "queued",
      sourceSha256: null,
      result: null,
      createdAt,
      updatedAt: createdAt,
    };
  }

  public buildAdmission(
    userId: string,
    now = Date.now(),
  ): "allowed" | "user-active" | "user-hourly" | "global-capacity" {
    const userActive = this.sql
      .prepare(
        "SELECT COUNT(*) AS count FROM builds WHERE requested_by=? AND status IN ('queued','running')",
      )
      .get(userId) as { count: number };
    if (userActive.count >= 1) return "user-active";
    const recent = this.sql
      .prepare(
        "SELECT COUNT(*) AS count FROM builds WHERE requested_by=? AND created_at>=?",
      )
      .get(userId, now - 60 * 60_000) as { count: number };
    if (recent.count >= 6) return "user-hourly";
    const globalActive = this.sql
      .prepare(
        "SELECT COUNT(*) AS count FROM builds WHERE status IN ('queued','running')",
      )
      .get() as { count: number };
    return globalActive.count >= 4 ? "global-capacity" : "allowed";
  }

  public updateBuild(
    id: string,
    status: "running" | "succeeded" | "failed",
    result: unknown = null,
    sourceSha256: string | null = null,
  ): void {
    this.sql
      .prepare(
        "UPDATE builds SET status=?,result_json=?,source_sha256=?,updated_at=? WHERE id=?",
      )
      .run(
        status,
        result === null ? null : JSON.stringify(result),
        sourceSha256,
        Date.now(),
        id,
      );
  }

  public build(
    mapId: string,
    buildId: string,
    userId: string,
  ): HostedBuildRecord | null {
    if (!this.map(mapId, userId)) return null;
    const row = this.sql
      .prepare(`SELECT id,map_version,profile_id,quality,status,source_sha256,result_json,created_at,updated_at
      FROM builds WHERE map_id=? AND id=?`)
      .get(mapId, buildId) as SqlBuild | undefined;
    return row ? hostedBuild(row) : null;
  }

  public listBuilds(
    mapId: string,
    userId: string,
  ): readonly HostedBuildRecord[] | null {
    const map = this.map(mapId, userId);
    if (!map) return null;
    const rows = this.sql
      .prepare(`SELECT id,map_version,profile_id,quality,status,source_sha256,result_json,created_at,updated_at
      FROM builds WHERE map_id=? ORDER BY created_at DESC LIMIT 20`)
      .all(mapId) as unknown as SqlBuild[];
    return rows.map(hostedBuild);
  }
}
