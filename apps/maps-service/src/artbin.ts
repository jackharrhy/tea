import { createHash } from "node:crypto";
import { z } from "zod";

export interface ArtbinConfig {
  readonly url: string;
  readonly fourmUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

const id = z.string().min(1).max(256);
const name = z.string().min(1).max(256);
const sha256 = z.string().regex(/^[a-f\d]{64}$/i);
const ArtbinAssetSchema = z.object({
  id,
  name,
  path: z.string().max(4_096),
  kind: z.string().min(1).max(128),
  mimeType: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
  sha256,
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  folder: z.object({ id, name, slug: z.string().min(1).max(256) }).nullable(),
  tags: z
    .array(z.object({ id, name, slug: z.string().min(1).max(256) }))
    .max(1_000),
});
export type ArtbinAsset = z.infer<typeof ArtbinAssetSchema>;

const ArtbinCatalogSchema = z.object({
  assets: z.array(ArtbinAssetSchema).max(10_000),
  nextCursor: z.string().max(4_096).nullable(),
});
export type ArtbinCatalog = z.infer<typeof ArtbinCatalogSchema>;

const ArtbinWadInspectionSchema = z.object({
  asset: ArtbinAssetSchema,
  wad: z.object({
    version: z.enum(["WAD2", "WAD3"]),
    lumpCount: z.number().int().nonnegative(),
    textures: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          name,
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          transparent: z.boolean(),
        }),
      )
      .max(100_000),
  }),
});
export type ArtbinWadInspection = z.infer<typeof ArtbinWadInspectionSchema>;

interface CachedToken {
  readonly value: string;
  readonly renewAt: number;
}

const ArtbinErrorBodySchema = z.looseObject({
  error: z
    .looseObject({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
    })
    .optional(),
});
type ArtbinErrorBody = z.infer<typeof ArtbinErrorBodySchema>;

const MachineTokenSchema = z.looseObject({
  access_token: z.string().min(1).max(16_384),
  token_type: z
    .string()
    .refine((value) => value.toLowerCase() === "bearer")
    .optional(),
  expires_in: z.number().finite().positive(),
});

const MACHINE_SCOPES = "artbin:assets:read artbin:assets:content";
const RENEWAL_SKEW_MS = 30_000;

const integrationErrorMessages = new Map([
  ["asset_not_found", "Artbin asset not found"],
  ["asset_hash_changed", "Artbin asset changed since it was mounted"],
  ["insufficient_scope", "Artbin machine identity has insufficient scope"],
  ["invalid_token", "Artbin machine authentication failed"],
]);

function integrationError(
  response: Response,
  body: ArtbinErrorBody,
): Error & { status: number } {
  const code = body.error?.code;
  const upstreamMessage = body.error?.message;
  const message =
    integrationErrorMessages.get(code ?? "") ??
    (upstreamMessage || "Artbin is unavailable");
  const status = [400, 404, 409, 413, 422, 503].includes(response.status)
    ? response.status
    : 502;
  return Object.assign(new Error(message), {
    status,
    code,
    details: body.error?.details,
  });
}

async function errorBody(response: Response): Promise<ArtbinErrorBody> {
  const parsed = ArtbinErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return parsed.success ? parsed.data : {};
}

async function payload<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw Object.assign(new Error("Artbin returned an invalid response"), {
      status: 502,
    });
  }
  return parsed.data;
}

export class ArtbinClient {
  private token: CachedToken | undefined;
  private tokenRequest: Promise<CachedToken> | undefined;

  public constructor(
    private readonly config: ArtbinConfig,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async acquireToken(): Promise<CachedToken> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: MACHINE_SCOPES,
    });
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
      "utf8",
    ).toString("base64");
    const response = await this.fetch(
      new URL("/oauth/token", this.config.fourmUrl),
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    ).catch(() => {
      throw Object.assign(
        new Error("4orm machine authentication is unavailable"),
        { status: 503 },
      );
    });
    if (!response.ok) {
      throw Object.assign(
        new Error("4orm machine authentication is unavailable"),
        {
          status: response.status === 503 ? 503 : 502,
        },
      );
    }
    const result = MachineTokenSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!result.success) {
      throw Object.assign(new Error("4orm returned an invalid machine token"), {
        status: 502,
      });
    }
    return {
      value: result.data.access_token,
      renewAt:
        this.now() +
        Math.max(0, result.data.expires_in * 1000 - RENEWAL_SKEW_MS),
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.now() < this.token.renewAt) return this.token.value;
    if (!this.tokenRequest) {
      this.tokenRequest = this.acquireToken();
      void this.tokenRequest.then(
        (token) => {
          this.token = token;
          this.tokenRequest = undefined;
        },
        () => {
          this.tokenRequest = undefined;
        },
      );
    }
    return (await this.tokenRequest).value;
  }

  private async request(
    path: string,
    retryInvalidToken = true,
  ): Promise<Response> {
    const token = await this.accessToken();
    const response = await this.fetch(new URL(path, this.config.url), {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {
      throw Object.assign(new Error("Artbin is unavailable"), { status: 503 });
    });
    if (response.ok) return response;
    const body = await errorBody(response);
    if (
      response.status === 401 &&
      body.error?.code === "invalid_token" &&
      retryInvalidToken
    ) {
      this.token = undefined;
      return this.request(path, false);
    }
    throw integrationError(response, body);
  }

  public async search(parameters: URLSearchParams): Promise<ArtbinCatalog> {
    const query = parameters.size ? `?${parameters}` : "";
    return payload(
      await this.request(`/api/assets${query}`),
      ArtbinCatalogSchema,
    );
  }

  public async metadata(assetId: string): Promise<{ asset: ArtbinAsset }> {
    return payload(
      await this.request(`/api/assets/${encodeURIComponent(assetId)}`),
      z.object({ asset: ArtbinAssetSchema }),
    );
  }

  public async content(
    assetId: string,
    expectedSha256: string,
  ): Promise<Uint8Array> {
    const parameters = new URLSearchParams({ sha256: expectedSha256 });
    const response = await this.request(
      `/api/assets/${encodeURIComponent(assetId)}/content?${parameters}`,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expectedSha256) {
      throw Object.assign(
        new Error("Artbin content failed SHA-256 verification"),
        { status: 502 },
      );
    }
    return bytes;
  }

  public async contentStream(
    assetId: string,
    expectedSha256: string,
  ): Promise<AsyncIterable<Uint8Array>> {
    const parameters = new URLSearchParams({ sha256: expectedSha256 });
    const response = await this.request(
      `/api/assets/${encodeURIComponent(assetId)}/content?${parameters}`,
    );
    if (!response.body)
      throw Object.assign(new Error("Artbin sent no asset content"), {
        status: 502,
      });
    return response.body;
  }

  public async inspectWad(assetId: string): Promise<ArtbinWadInspection> {
    return payload(
      await this.request(`/api/assets/${encodeURIComponent(assetId)}/wad`),
      ArtbinWadInspectionSchema,
    );
  }
}
