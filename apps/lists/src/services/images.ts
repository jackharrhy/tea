import sharp from "sharp";
import { s3ClientConfig } from "./aws";
import type { Config } from "../config";

export type ProcessedImage = {
  data: Buffer;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  dataUri: string;
};

export async function processImage(
  input: Buffer | ArrayBuffer,
): Promise<ProcessedImage> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  const image = sharp(buf)
    .resize({ width: 600, withoutEnlargement: true })
    .webp({ quality: 80 });

  const data = await image.toBuffer();
  const metadata = await sharp(data).metadata();

  const dataUri = `data:image/webp;base64,${data.toString("base64")}`;

  return {
    data,
    mimeType: "image/webp",
    sizeBytes: data.length,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    dataUri,
  };
}

// Extract s3-pending UUIDs from markdown (data URIs are no longer embedded)
function extractPendingUUIDs(markdown: string): string[] {
  const regex = /<!-- s3-pending:([a-f0-9-]+) -->/g;
  const uuids: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    uuids.push(match[1]!);
  }
  return uuids;
}

// pendingMap: { uuid: dataUri } -- submitted as a JSON field from the browser
export async function processPendingS3Images(
  markdown: string,
  campaignId: number,
  pendingMap: Record<string, string>,
  config: Config,
): Promise<string> {
  if (!config.s3MediaBucket) return markdown;

  const uuids = extractPendingUUIDs(markdown);
  if (uuids.length === 0) return markdown;

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client(s3ClientConfig(config));
  const baseUrl =
    config.s3MediaBaseUrl ||
    `https://${config.s3MediaBucket}.s3.${config.awsRegion}.amazonaws.com`;

  let result = markdown;
  for (const uuid of uuids) {
    const dataUri = pendingMap[uuid];
    if (!dataUri) continue;

    const key = `images/${campaignId}/${uuid}.webp`;
    const base64 = dataUri.replace("data:image/webp;base64,", "");
    const buf = Buffer.from(base64, "base64");

    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3MediaBucket,
        Key: key,
        Body: buf,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000",
      }),
    );

    const url = `${baseUrl}/${key}`;
    result = result.replace(
      `<!-- s3-pending:${uuid} -->`,
      `![image](${url})\n`,
    );
  }

  return result;
}

export async function deleteCampaignS3Images(
  campaignId: number,
  config: Config,
): Promise<void> {
  if (!config.s3MediaBucket) return;

  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } =
    await import("@aws-sdk/client-s3");
  const s3 = new S3Client(s3ClientConfig(config));
  const prefix = `images/${campaignId}/`;

  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: config.s3MediaBucket,
      Prefix: prefix,
    }),
  );

  if (!listed.Contents || listed.Contents.length === 0) return;

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: config.s3MediaBucket,
      Delete: {
        Objects: listed.Contents.map((obj) => ({ Key: obj.Key! })),
      },
    }),
  );

  console.log(
    `Deleted ${listed.Contents.length} S3 objects for campaign ${campaignId}`,
  );
}
