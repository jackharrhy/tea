import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const bucket = process.env.CELLD_BUCKET;
if (!bucket) throw new Error("CELLD_BUCKET is required");
const celld = process.env.CELLD_BIN ?? "celld";
const deployConfig = process.env.RADIO_CELLD_DEPLOY_CONFIG ?? ".";
if (![".", "wrangler.celld-cutover.jsonc"].includes(deployConfig)) {
  throw new Error(
    "RADIO_CELLD_DEPLOY_CONFIG must select the default or cutover config",
  );
}
const environment = {
  ...process.env,
  CELLD_ESBUILD:
    process.env.CELLD_ESBUILD ??
    createRequire(import.meta.url).resolve("esbuild/bin/esbuild"),
};

if (bucket.startsWith("sqlite:///")) {
  if (bucket.includes("%"))
    throw new Error("SQLite bucket paths must not contain percent escapes");
  const location = new URL(bucket);
  const database = decodeURIComponent(location.pathname);
  if (
    location.host ||
    location.search ||
    location.hash ||
    !isAbsolute(database)
  ) {
    throw new Error(
      "The SQLite bucket must name an absolute database path without a host or query",
    );
  }
  await mkdir(dirname(database), { recursive: true, mode: 0o750 });
  // A crashed node's last lease can remain live briefly; wait for it to expire.
  await retry("verify the SQLite backend", () =>
    run(["diagnose", "--bucket", bucket, "--no-control-plane"]),
  );
} else if (bucket.startsWith("az://")) {
  const emulator = environment.AZURE_STORAGE_USE_EMULATOR ?? "true";
  if (!["true", "false", "1", "0"].includes(emulator)) {
    throw new Error("AZURE_STORAGE_USE_EMULATOR must be true or false");
  }
  environment.AZURE_STORAGE_USE_EMULATOR = emulator;
  if (emulator === "true" || emulator === "1") await prepareAzurite();
  await retry("verify the Azure backend", () =>
    run(["diagnose", "--bucket", bucket]),
  );
} else {
  throw new Error(
    "CELLD_BUCKET must be sqlite:///absolute/path/objects.sqlite3 or az://CONTAINER",
  );
}

run(["deploy", deployConfig, "--bucket", bucket]);

async function prepareAzurite() {
  const { BlobServiceClient, StorageSharedKeyCredential } =
    await import("@azure/storage-blob");
  const account = environment.AZURE_STORAGE_ACCOUNT_NAME ?? "devstoreaccount1";
  const accountKey =
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";
  const container = bucket.slice(5).split("/", 1)[0];
  if (!container) throw new Error("The Azure bucket must name a container");
  const base = environment.AZURITE_BLOB_STORAGE_URL ?? "http://127.0.0.1:10000";
  const endpoint =
    environment.AZURITE_BLOB_ENDPOINT ??
    `${base.replace(/\/$/, "")}/${account}`;
  environment.AZURE_STORAGE_ACCOUNT_NAME = account;
  await retry("create the Azurite container", async () => {
    const credential = new StorageSharedKeyCredential(account, accountKey);
    const client = new BlobServiceClient(
      endpoint,
      credential,
    ).getContainerClient(container);
    await client.createIfNotExists();
  });
}

function run(args) {
  const result = spawnSync(celld, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`celld ${args.join(" ")} failed`);
}

async function retry(description, operation) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // Retry only after the previous attempt fails.
      // eslint-disable-next-line no-await-in-loop
      return await operation();
    } catch (error) {
      if (attempt >= 30)
        throw new Error(`Failed to ${description}`, { cause: error });
      // eslint-disable-next-line no-await-in-loop
      await delay(1_000);
    }
  }
}
