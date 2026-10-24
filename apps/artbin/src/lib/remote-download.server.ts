import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import {
  isAllowedRemoteDownloadUrl,
  type RemoteImportProvider,
} from "./import-sources.server.ts";
import { resolvePublicHttpsUrl } from "./public-remote-url.server.ts";

export const MAX_REMOTE_DOWNLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface RemoteDownloadResult {
  bytes: number;
  md5: string;
  finalUrl: string;
}

function isRedirect(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

export async function downloadRemoteFile(
  provider: RemoteImportProvider,
  inputUrl: string,
  destinationPath: string,
  expectedSize?: number,
  expectedMd5?: string,
): Promise<RemoteDownloadResult> {
  if (provider === "direct") {
    return downloadDirectRemoteFile(
      inputUrl,
      destinationPath,
      expectedSize,
      expectedMd5,
    );
  }

  let url = inputUrl;
  let response: Response | undefined;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!isAllowedRemoteDownloadUrl(provider, url)) {
      throw new Error(
        `The ${provider} download redirected to an untrusted host`,
      );
    }

    response = await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": "artbin/0.1 (+https://github.com/jackharrhy/tea)",
      },
      signal: AbortSignal.timeout(10 * 60_000),
    });

    if (!isRedirect(response.status)) break;
    const location = response.headers.get("location");
    if (!location)
      throw new Error("Download redirect did not include a location");
    url = new URL(location, url).toString();
    response.body?.cancel().catch(() => {});
  }

  if (!response || isRedirect(response.status))
    throw new Error("Download exceeded the redirect limit");
  if (!response.ok)
    throw new Error(
      `Download returned ${response.status} ${response.statusText}`,
    );
  if (!response.body)
    throw new Error("Download returned an empty response body");

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REMOTE_DOWNLOAD_BYTES
  ) {
    throw new Error("Download is larger than the 1 GB safety limit");
  }
  if (expectedSize && expectedSize > MAX_REMOTE_DOWNLOAD_BYTES) {
    throw new Error(
      "Source metadata reports a file larger than the 1 GB safety limit",
    );
  }

  const file = await open(destinationPath, "wx");
  const hash = createHash("md5");
  let bytes = 0;

  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REMOTE_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error("Download exceeded the 1 GB safety limit");
      }
      hash.update(value);
      await file.write(value);
    }
  } catch (error) {
    await file.close();
    await unlink(destinationPath).catch(() => {});
    throw error;
  }

  await file.close();
  const md5 = hash.digest("hex");
  if (expectedSize && bytes !== expectedSize) {
    await unlink(destinationPath).catch(() => {});
    throw new Error(
      `Downloaded size did not match source metadata (${bytes} != ${expectedSize})`,
    );
  }
  if (expectedMd5 && md5.toLowerCase() !== expectedMd5.toLowerCase()) {
    await unlink(destinationPath).catch(() => {});
    throw new Error("Downloaded file failed its GameBanana checksum");
  }

  return { bytes, md5, finalUrl: response.url || url };
}

async function requestPublicUrl(inputUrl: string): Promise<IncomingMessage> {
  const { url, address } = await resolvePublicHttpsUrl(inputUrl);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: {
          "user-agent": "artbin/0.1 (+https://github.com/jackharrhy/tea)",
        },
        signal: AbortSignal.timeout(10 * 60_000),
        family: address.family,
        lookup: (_hostname, _options, callback) => {
          callback(null, address.address, address.family);
        },
      },
      resolve,
    );
    request.on("error", reject);
    request.end();
  });
}

async function downloadDirectRemoteFile(
  inputUrl: string,
  destinationPath: string,
  expectedSize?: number,
  expectedMd5?: string,
): Promise<RemoteDownloadResult> {
  let url = inputUrl;
  let response: IncomingMessage | undefined;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    response = await requestPublicUrl(url);
    if (!isRedirect(response.statusCode ?? 0)) break;
    const location = response.headers.location;
    response.resume();
    if (!location)
      throw new Error("Download redirect did not include a location");
    url = new URL(location, url).toString();
  }

  if (!response || isRedirect(response.statusCode ?? 0)) {
    throw new Error("Download exceeded the redirect limit");
  }
  if (
    (response.statusCode ?? 500) < 200 ||
    (response.statusCode ?? 500) >= 300
  ) {
    response.resume();
    throw new Error(
      `Download returned HTTP ${response.statusCode ?? "unknown"}`,
    );
  }

  const contentLength = Number(response.headers["content-length"]);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REMOTE_DOWNLOAD_BYTES
  ) {
    response.destroy();
    throw new Error("Download is larger than the 1 GB safety limit");
  }
  if (expectedSize && expectedSize > MAX_REMOTE_DOWNLOAD_BYTES) {
    response.destroy();
    throw new Error(
      "Source metadata reports a file larger than the 1 GB safety limit",
    );
  }

  const file = await open(destinationPath, "wx");
  const hash = createHash("md5");
  let bytes = 0;

  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_REMOTE_DOWNLOAD_BYTES) {
        response.destroy();
        throw new Error("Download exceeded the 1 GB safety limit");
      }
      hash.update(buffer);
      await file.write(buffer);
    }
  } catch (error) {
    await file.close();
    await unlink(destinationPath).catch(() => {});
    throw error;
  }

  await file.close();
  const md5 = hash.digest("hex");
  if (expectedSize && bytes !== expectedSize) {
    await unlink(destinationPath).catch(() => {});
    throw new Error(
      `Downloaded size did not match source metadata (${bytes} != ${expectedSize})`,
    );
  }
  if (expectedMd5 && md5.toLowerCase() !== expectedMd5.toLowerCase()) {
    await unlink(destinationPath).catch(() => {});
    throw new Error("Downloaded file failed its expected checksum");
  }

  return { bytes, md5, finalUrl: url };
}
