import { randomBytes } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { decrypt, encrypt, loadDataKey } from "shared";
import { prisma } from "@/lib/db";

// File attachment storage on any S3-compatible service.
//
// - Settings come from StorageSettings (edited in /admin). While none are
//   saved, the bundled SeaweedFS from docker-compose.yml is used.
// - Content is encrypted with the instance data key before upload (AAD bound
//   to the file id), so the storage provider only ever holds ciphertext.
// - Object keys are keyPrefix + "files/" + id and don't depend on anything
//   else, so moving storage is a plain bucket copy (an infrastructure task;
//   the app never migrates objects itself).

const SECRET_AAD = "knowlective:s3-secret";
const fileAad = (id: string) => `knowlective:file:${id}`;

// Hard cap for the admin-configurable upload limit: files are encrypted in
// memory as a whole, so this bounds per-request memory use.
export const MAX_FILE_SIZE_MB_LIMIT = 500;
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 100;
const BUNDLED_BUCKET = "knowlective";

export type StorageConfig = {
  source: "custom" | "bundled";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  keyPrefix: string;
};

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage is not configured");
  }
}

// Signing needs a region. AWS endpoints carry it in the host; everything else
// (SeaweedFS, MinIO, R2, …) accepts us-east-1.
export function resolveRegion(endpoint: string, region: string | null | undefined): string {
  if (region?.trim()) return region.trim();
  const m = /(?:^|\.)s3[.-]([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/i.exec(new URL(endpoint).hostname);
  return m && m[1] !== "external-1" ? m[1] : "us-east-1";
}

export function normalizeKeyPrefix(raw: string): string {
  const p = raw.trim().replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  return p && !p.endsWith("/") ? `${p}/` : p;
}

let warnedAccessKey = false;

function bundledConfig(): StorageConfig | null {
  const accessKeyId = process.env.SEAWEEDFS_ACCESS_KEY;
  const secretAccessKey = process.env.SEAWEEDFS_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  // The access key is part of the request signature's "<key>/<date>/…": with
  // a "/" in it (e.g. a base64 value) the storage rejects every request.
  if (!/^[A-Za-z0-9]+$/.test(accessKeyId) && !warnedAccessKey) {
    warnedAccessKey = true;
    console.error(
      "[files] SEAWEEDFS_ACCESS_KEY must be letters and digits only; uploads will fail. " +
        "Generate a new one with `pnpm gen:storage-key`, recreate the seaweedfs container and restart.",
    );
  }
  return {
    source: "bundled",
    endpoint: process.env.KNOWLECTIVE_BUNDLED_S3_ENDPOINT || "http://localhost:8333",
    region: "us-east-1",
    bucket: BUNDLED_BUCKET,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
    keyPrefix: "",
  };
}

export async function getStorageConfig(): Promise<StorageConfig | null> {
  const row = await prisma.storageSettings.findUnique({ where: { id: 1 } });
  if (!row) return bundledConfig();
  return {
    source: "custom",
    endpoint: row.endpoint,
    region: resolveRegion(row.endpoint, row.region),
    bucket: row.bucket,
    accessKeyId: row.accessKeyId,
    secretAccessKey: decrypt(await loadDataKey(prisma), row.secretAccessKeyEnc, SECRET_AAD).toString("utf8"),
    forcePathStyle: row.forcePathStyle,
    keyPrefix: row.keyPrefix,
  };
}

// What /admin shows: no secret, plus where the values came from.
export type StorageSettingsView = Omit<StorageConfig, "secretAccessKey" | "region"> & {
  region: string | null;
};

export async function getStorageSettingsView(): Promise<StorageSettingsView | null> {
  const row = await prisma.storageSettings.findUnique({
    where: { id: 1 },
    omit: { id: true, secretAccessKeyEnc: true, updatedAt: true },
  });
  if (row) return { source: "custom", ...row };
  const bundled = bundledConfig();
  if (!bundled) return null;
  return {
    source: bundled.source,
    endpoint: bundled.endpoint,
    region: null,
    bucket: bundled.bucket,
    accessKeyId: bundled.accessKeyId,
    forcePathStyle: bundled.forcePathStyle,
    keyPrefix: bundled.keyPrefix,
  };
}

export type StorageSettingsInput = {
  endpoint: string;
  region: string | null;
  bucket: string;
  accessKeyId: string;
  // undefined = keep the stored secret.
  secretAccessKey: string | undefined;
  forcePathStyle: boolean;
  keyPrefix: string;
};

export async function saveStorageSettings(input: StorageSettingsInput): Promise<void> {
  const { secretAccessKey, ...fields } = input;
  const secretAccessKeyEnc =
    secretAccessKey !== undefined
      ? Uint8Array.from(encrypt(await loadDataKey(prisma), Buffer.from(secretAccessKey, "utf8"), SECRET_AAD))
      : undefined;
  const existing = await prisma.storageSettings.findUnique({ where: { id: 1 }, select: { id: true } });
  if (existing) {
    await prisma.storageSettings.update({
      where: { id: 1 },
      data: { ...fields, ...(secretAccessKeyEnc ? { secretAccessKeyEnc } : {}) },
    });
  } else {
    if (!secretAccessKeyEnc) throw new Error("secretAccessKey is required");
    await prisma.storageSettings.create({ data: { ...fields, secretAccessKeyEnc } });
  }
}

// Largest file an editor may attach (MB). Set in /admin, independent of the
// storage in use.
export async function getMaxUploadSizeMb(): Promise<number> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { maxUploadSizeMb: true } });
  return Math.min(config?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB, MAX_FILE_SIZE_MB_LIMIT);
}

// Extensions of the files an editor may attach (lib/upload-types.ts). Empty =
// any file.
export async function getAllowedUploadExtensions(): Promise<string[]> {
  const config = await prisma.instanceConfig.findUnique({ where: { id: 1 }, select: { uploadAllowedExtensions: true } });
  return config?.uploadAllowedExtensions ?? [];
}

// Back to the bundled SeaweedFS.
export async function resetStorageSettings(): Promise<void> {
  await prisma.storageSettings.deleteMany({});
}

function clientFor(config: StorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Only send/verify checksums when the API requires it: several
    // S3-compatible services reject the newer default CRC32 headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 2,
  });
}

export function objectKey(config: Pick<StorageConfig, "keyPrefix">, fileId: string): string {
  return `${config.keyPrefix}files/${fileId}`;
}

const isNoSuchBucket = (err: unknown) =>
  err instanceof S3ServiceException && (err.name === "NoSuchBucket" || err.$metadata.httpStatusCode === 404);

async function putObject(config: StorageConfig, client: S3Client, key: string, body: Uint8Array) {
  const put = () =>
    client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: "application/octet-stream" }));
  try {
    await put();
  } catch (err) {
    // The bundled storage starts empty: create its bucket on first use.
    // Never auto-create buckets on user-configured storage.
    if (config.source !== "bundled" || !isNoSuchBucket(err)) throw err;
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    await put();
  }
}

export async function putFile(config: StorageConfig, fileId: string, plaintext: Uint8Array): Promise<void> {
  const body = Uint8Array.from(encrypt(await loadDataKey(prisma), plaintext, fileAad(fileId)));
  const client = clientFor(config);
  try {
    await putObject(config, client, objectKey(config, fileId), body);
  } finally {
    client.destroy();
  }
}

export async function getFile(config: StorageConfig, fileId: string): Promise<Buffer> {
  const client = clientFor(config);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey(config, fileId) }));
    const bytes = await res.Body!.transformToByteArray();
    return decrypt(await loadDataKey(prisma), bytes, fileAad(fileId));
  } finally {
    client.destroy();
  }
}

export async function deleteFileObject(config: StorageConfig, fileId: string): Promise<void> {
  const client = clientFor(config);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey(config, fileId) }));
  } finally {
    client.destroy();
  }
}

export type StorageTestResult =
  | { ok: true; checkedExisting: number; missingExisting: number }
  | { ok: false; step: "write" | "read" | "delete"; message: string };

// Writes, reads back and deletes a small object, then checks that a few of
// the already-uploaded files are present (catches an incomplete migration).
export async function testStorage(config: StorageConfig): Promise<StorageTestResult> {
  const client = clientFor(config);
  const key = `${config.keyPrefix}knowlective-connection-test-${randomBytes(6).toString("hex")}`;
  const payload = randomBytes(32);
  let step: "write" | "read" | "delete" = "write";
  try {
    await putObject(config, client, key, payload);
    step = "read";
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const back = Buffer.from(await res.Body!.transformToByteArray());
    if (!back.equals(payload)) throw new Error("読み出した内容が書き込んだ内容と一致しません");
    step = "delete";
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));

    const sample = await prisma.fileObject.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { id: true } });
    let missing = 0;
    for (const f of sample) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey(config, f.id) }));
      } catch {
        missing++;
      }
    }
    return { ok: true, checkedExisting: sample.length, missingExisting: missing };
  } catch (err) {
    return { ok: false, step, message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  } finally {
    client.destroy();
  }
}
