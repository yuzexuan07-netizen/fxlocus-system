import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const endpointRaw = process.env.R2_ENDPOINT || "";
const bucketName = process.env.R2_BUCKET || "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
const publicBaseRaw = process.env.R2_PUBLIC_BASE_URL || process.env.R2_CDN_BASE_URL || "";

const normalizeEndpoint = (raw: string, bucket: string) => {
  if (!raw) return "";
  const withScheme =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  if (bucket) {
    const suffix = `/${bucket}`;
    if (withScheme.endsWith(suffix)) return withScheme.slice(0, -suffix.length);
  }
  return withScheme;
};
const endpoint = normalizeEndpoint(endpointRaw, bucketName);
const publicBase = publicBaseRaw
  ? publicBaseRaw.startsWith("http://") || publicBaseRaw.startsWith("https://")
    ? publicBaseRaw
    : `https://${publicBaseRaw}`
  : "";

let client: S3Client | null = null;
const globalCache = globalThis as {
  __fx_r2_bucket_binding?: any | null;
  __fx_r2_bucket_binding_promise?: Promise<any | null> | null;
};
if (!("__fx_r2_bucket_binding" in globalCache)) globalCache.__fx_r2_bucket_binding = null;
if (!("__fx_r2_bucket_binding_promise" in globalCache)) globalCache.__fx_r2_bucket_binding_promise = null;

export function r2Enabled() {
  return Boolean(endpoint && accessKeyId && secretAccessKey && bucketName);
}

export function getR2Bucket() {
  return bucketName;
}

export function getR2PublicBaseUrl() {
  return publicBase;
}

export function isR2Bucket(bucket: string | null | undefined) {
  return r2Enabled() && Boolean(bucket && bucket === bucketName);
}

async function getR2Binding() {
  if (globalCache.__fx_r2_bucket_binding) return globalCache.__fx_r2_bucket_binding;
  if (globalCache.__fx_r2_bucket_binding_promise) return globalCache.__fx_r2_bucket_binding_promise;

  const task = (async () => {
    try {
      const ctx = await getCloudflareContext({ async: true });
      const binding = (ctx?.env as any)?.R2_ASSETS || null;
      globalCache.__fx_r2_bucket_binding = binding;
      return binding;
    } catch {
      globalCache.__fx_r2_bucket_binding = null;
      return null;
    }
  })().finally(() => {
    globalCache.__fx_r2_bucket_binding_promise = null;
  });

  globalCache.__fx_r2_bucket_binding_promise = task;
  return task;
}

function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey }
    });
  }
  return client;
}

type PresignGetOptions = {
  disposition?: "inline" | "attachment";
  filename?: string;
  contentType?: string;
};

export async function r2PresignGet(key: string, expiresIn = 3600, options?: PresignGetOptions) {
  if (!r2Enabled()) {
    const binding = await getR2Binding();
    const publicUrl = r2PublicUrl(key);
    if (binding && publicUrl) return publicUrl;
    throw new Error("R2_NOT_CONFIGURED");
  }
  const disposition = options?.disposition === "attachment" ? "attachment" : "inline";
  const filename = String(options?.filename || "")
    .trim()
    .replace(/["\\]/g, "_");
  const responseContentDisposition =
    disposition === "attachment"
      ? filename
        ? `attachment; filename="${filename}"`
        : "attachment"
      : "inline";
  const responseContentType = String(options?.contentType || "").trim();
  const cmd = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentDisposition: responseContentDisposition,
    ResponseContentType: responseContentType || undefined
  });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

export async function r2PresignPut(key: string, contentType: string, expiresIn = 3600) {
  if (!r2Enabled()) throw new Error("R2_NOT_CONFIGURED");
  const cmd = new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType });
  return getSignedUrl(getClient(), cmd, { expiresIn });
}

export async function r2UploadBuffer(
  key: string,
  body: Buffer | ArrayBuffer | Uint8Array,
  contentType: string
) {
  const payload: Uint8Array | Buffer = Buffer.isBuffer(body)
    ? body
    : body instanceof Uint8Array
      ? body
      : new Uint8Array(body);
  const binding = await getR2Binding();
  if (binding && typeof binding.put === "function") {
    await binding.put(key, payload, {
      httpMetadata: {
        contentType
      }
    });
    return;
  }
  if (!r2Enabled()) throw new Error("R2_NOT_CONFIGURED");
  const cmd = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: payload,
    ContentType: contentType
  });
  await getClient().send(cmd);
}

function encodeCopySourceKey(key: string) {
  return String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function r2CopyObject(sourceKey: string, targetKey: string) {
  const from = String(sourceKey || "").replace(/^\/+/, "");
  const to = String(targetKey || "").replace(/^\/+/, "");
  if (!from || !to || from === to) return;

  const binding = await getR2Binding();
  if (binding && typeof binding.get === "function" && typeof binding.put === "function") {
    const source = await binding.get(from);
    if (!source) throw new Error("SOURCE_NOT_FOUND");
    const body = await source.arrayBuffer();
    await binding.put(to, body, {
      httpMetadata: {
        contentType: source.httpMetadata?.contentType || undefined
      }
    });
    return;
  }

  if (!r2Enabled()) throw new Error("R2_NOT_CONFIGURED");
  const cmd = new CopyObjectCommand({
    Bucket: bucketName,
    Key: to,
    CopySource: `${bucketName}/${encodeCopySourceKey(from)}`
  });
  await getClient().send(cmd);
}

export async function r2DeleteObjects(keys: string[]) {
  if (!keys.length) return;
  const binding = await getR2Binding();
  if (binding && typeof binding.delete === "function") {
    await binding.delete(keys);
    return;
  }
  if (!r2Enabled()) throw new Error("R2_NOT_CONFIGURED");
  const cmd = new DeleteObjectsCommand({
    Bucket: bucketName,
    Delete: { Objects: keys.map((key) => ({ Key: key })) }
  });
  await getClient().send(cmd);
}

export async function r2ObjectExists(key: string) {
  const binding = await getR2Binding();
  if (binding && typeof binding.head === "function") {
    try {
      const head = await binding.head(key);
      return Boolean(head);
    } catch {
      return false;
    }
  }
  if (!r2Enabled()) return false;
  try {
    const cmd = new HeadObjectCommand({ Bucket: bucketName, Key: key });
    await getClient().send(cmd);
    return true;
  } catch {
    return false;
  }
}

export async function r2ListKeys(prefix = "", maxItems = 5000) {
  const normalizedPrefix = String(prefix || "").replace(/^\/+/, "");
  const binding = await getR2Binding();
  const keys: string[] = [];
  if (binding && typeof binding.list === "function") {
    let cursor: string | undefined = undefined;
    do {
      const res: any = await binding.list({
        prefix: normalizedPrefix || undefined,
        cursor,
        limit: Math.min(1000, maxItems > 0 ? Math.max(1, maxItems - keys.length) : 1000)
      });
      for (const item of res?.objects || []) {
        const key = String(item?.key || "").trim();
        if (!key) continue;
        keys.push(key);
        if (maxItems > 0 && keys.length >= maxItems) return keys;
      }
      cursor = res?.truncated ? String(res?.cursor || "") || undefined : undefined;
    } while (cursor);
    return keys;
  }
  if (!r2Enabled()) return [] as string[];

  let continuationToken: string | undefined = undefined;

  do {
    const res: ListObjectsV2CommandOutput = await getClient().send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedPrefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000
      })
    );

    for (const item of res.Contents || []) {
      if (!item?.Key) continue;
      keys.push(String(item.Key));
      if (maxItems > 0 && keys.length >= maxItems) return keys;
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export function r2PublicUrl(key: string) {
  const base = getR2PublicBaseUrl();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${String(key || "").replace(/^\/+/, "")}`;
}

type ParsedByteRange =
  | { kind: "offset"; offset: number; length?: number }
  | { kind: "suffix"; suffix: number };

function parseRangeHeader(rangeHeader: string | null | undefined): ParsedByteRange | null {
  const raw = String(rangeHeader || "").trim();
  if (!raw || !raw.toLowerCase().startsWith("bytes=")) return null;
  const [startRaw, endRaw] = raw.slice(6).split("-", 2).map((item) => String(item || "").trim());
  if (!startRaw && !endRaw) return null;
  if (!startRaw) {
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { kind: "suffix", suffix };
  }
  const offset = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(offset) || offset < 0) return null;
  const end = endRaw ? Number.parseInt(endRaw, 10) : NaN;
  if (endRaw && (!Number.isFinite(end) || end < offset)) return null;
  if (Number.isFinite(end)) {
    return { kind: "offset", offset, length: end - offset + 1 };
  }
  return { kind: "offset", offset };
}

export type R2ObjectReadResult = {
  body: Uint8Array;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  contentRange: string | null;
  acceptRanges: string | null;
};

export async function r2ReadObject(
  key: string,
  rangeHeader?: string | null
): Promise<R2ObjectReadResult | null> {
  const normalizedKey = String(key || "").replace(/^\/+/, "");
  if (!normalizedKey) return null;

  const parsedRange = parseRangeHeader(rangeHeader);
  const binding = await getR2Binding();
  if (binding && typeof binding.get === "function") {
    try {
      const getOptions: any = {};
      if (parsedRange?.kind === "offset") {
        getOptions.range = {
          offset: parsedRange.offset,
          ...(parsedRange.length ? { length: parsedRange.length } : {})
        };
      } else if (parsedRange?.kind === "suffix") {
        getOptions.range = { suffix: parsedRange.suffix };
      }
      const object = await binding.get(normalizedKey, Object.keys(getOptions).length ? getOptions : undefined);
      if (!object) return null;
      const arrayBuffer = await object.arrayBuffer();
      const contentType = String(object.httpMetadata?.contentType || "").trim() || null;
      const contentLength = Number.isFinite(object.size) ? Number(object.size) : arrayBuffer.byteLength;
      const range = object.range || null;
      const rangeOffset =
        range && Number.isFinite(Number(range.offset)) ? Number(range.offset) : parsedRange?.kind === "offset" ? parsedRange.offset : null;
      const rangeLength =
        range && Number.isFinite(Number(range.length)) ? Number(range.length) : arrayBuffer.byteLength;
      const contentRange =
        rangeOffset !== null && contentLength && rangeLength
          ? `bytes ${rangeOffset}-${rangeOffset + rangeLength - 1}/${contentLength}`
          : null;
      const status = contentRange ? 206 : 200;
      return {
        body: new Uint8Array(arrayBuffer),
        status,
        contentType,
        contentLength: arrayBuffer.byteLength,
        contentRange,
        acceptRanges: "bytes"
      };
    } catch {
      return null;
    }
  }

  if (!r2Enabled()) return null;
  try {
    const res = await getClient().send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: normalizedKey,
        ...(rangeHeader ? { Range: rangeHeader } : {})
      })
    );
    if (!res.Body) return null;
    const bytes = new Uint8Array(await res.Body.transformToByteArray());
    return {
      body: bytes,
      status: rangeHeader ? 206 : 200,
      contentType: String(res.ContentType || "").trim() || null,
      contentLength: bytes.byteLength,
      contentRange: String((res as any).ContentRange || "").trim() || null,
      acceptRanges: "bytes"
    };
  } catch {
    return null;
  }
}
