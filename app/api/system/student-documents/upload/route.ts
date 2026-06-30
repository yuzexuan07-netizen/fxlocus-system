import { NextResponse } from "next/server";
import path from "path";

import { requireSystemUser } from "@/lib/system/guard";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { getR2Bucket, r2Enabled } from "@/lib/storage/r2";
import { uploadBufferToStorage } from "@/lib/storage/storage";
import { invalidateStudentDocumentsCache } from "@/lib/system/cacheInvalidation";
import { buildStudentSubmitContent } from "@/lib/system/notify";
import { STUDENT_STATUS_NORMAL } from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIMARY_BUCKET = "fxlocus_student_docs";
const FALLBACK_BUCKET = "fxlocus-student-docs";
const DOC_TYPES = ["enrollment_form", "trial_screenshot", "verification_image"] as const;
const ENROLLMENT_EXTS = new Set([".doc", ".docx", ".pdf"]);
const ENROLLMENT_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
  "image/heic",
  "image/heif"
]);
const MAX_VERIFICATION_IMAGES = 3;

type DocType = (typeof DOC_TYPES)[number];

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isAllowedEnrollment(file: File) {
  const ext = path.extname(file.name || "").toLowerCase();
  if (ENROLLMENT_EXTS.has(ext)) return true;
  if (file.type && ENROLLMENT_MIMES.has(file.type)) return true;
  return false;
}

function isAllowedImage(file: File) {
  const mime = String(file.type || "").toLowerCase();
  if (mime && (IMAGE_MIMES.has(mime) || mime.startsWith("image/"))) return true;
  const ext = path.extname(file.name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".heic", ".heif", ".jfif"].includes(ext);
}

function randomStamp() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeIdPart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "")
    .slice(0, 96);
}

function buildUploadRowId(userId: string, requestId: string, docType: string, index: number) {
  return ["studentdoc", sanitizeIdPart(userId), sanitizeIdPart(requestId), sanitizeIdPart(docType), String(index)].join(
    "_"
  );
}

function makeStoragePath(userId: string, docType: string, file: File, requestId?: string | null, index?: number) {
  const ext = path.extname(file.name || "").toLowerCase();
  const suffix = ext && ext.length <= 10 ? ext : "";
  if (requestId) {
    return `student-documents/${userId}/${docType}/${sanitizeIdPart(requestId)}_${String(index ?? 0)}${suffix}`;
  }
  return `student-documents/${userId}/${docType}/${randomStamp()}${suffix}`;
}

async function resolveBucket(admin: any) {
  try {
    const { data, error } = await admin.storage.listBuckets();
    if (!error && data?.length) {
      if (data.some((bucket: any) => bucket.id === PRIMARY_BUCKET)) return PRIMARY_BUCKET;
      if (data.some((bucket: any) => bucket.id === FALLBACK_BUCKET)) return FALLBACK_BUCKET;
    }
  } catch {
    // ignore and try create
  }

  const primary = await admin.storage.createBucket(PRIMARY_BUCKET, { public: false });
  if (!primary.error || String(primary.error.message || "").includes("exists")) {
    return PRIMARY_BUCKET;
  }

  const fallback = await admin.storage.createBucket(FALLBACK_BUCKET, { public: false });
  if (!fallback.error || String(fallback.error.message || "").includes("exists")) {
    return FALLBACK_BUCKET;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSystemUser();
    if (user.student_status !== STUDENT_STATUS_NORMAL) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const form = await req.formData();
    const requestId = String(form.get("requestId") || "").trim();
    const docTypeRaw = String(form.get("docType") || form.get("type") || "").trim();
    const normalizedDocType: DocType | null = DOC_TYPES.includes(docTypeRaw as DocType)
      ? (docTypeRaw as DocType)
      : null;
    const bundleMode = !normalizedDocType;

    const filesByType: Record<DocType, File[]> = {
      enrollment_form: [],
      trial_screenshot: [],
      verification_image: []
    };

    if (!bundleMode) {
      const docType = normalizedDocType as DocType;
      filesByType[docType] = [...form.getAll("files"), ...form.getAll("file")].filter(
        (f) => f instanceof File
      ) as File[];
      if (!filesByType[docType].length) return json({ ok: false, error: "NO_FILES" }, 400);
      if ((docType === "enrollment_form" || docType === "trial_screenshot") && filesByType[docType].length > 1) {
        return json({ ok: false, error: "TOO_MANY_FILES" }, 400);
      }
      if (docType === "verification_image" && filesByType[docType].length > MAX_VERIFICATION_IMAGES) {
        return json({ ok: false, error: "TOO_MANY_FILES" }, 400);
      }
      for (const file of filesByType[docType]) {
        const ok = docType === "enrollment_form" ? isAllowedEnrollment(file) : isAllowedImage(file);
        if (!ok) return json({ ok: false, error: "INVALID_FILE" }, 400);
      }
    } else {
      DOC_TYPES.forEach((docType) => {
        filesByType[docType] = form.getAll(docType).filter((f) => f instanceof File) as File[];
      });
      if (
        !filesByType.enrollment_form.length ||
        !filesByType.trial_screenshot.length ||
        !filesByType.verification_image.length
      ) {
        return json({ ok: false, error: "REQUIRED_FILES" }, 400);
      }
      if (filesByType.enrollment_form.length > 1 || filesByType.trial_screenshot.length > 1) {
        return json({ ok: false, error: "TOO_MANY_FILES" }, 400);
      }
      if (filesByType.verification_image.length > MAX_VERIFICATION_IMAGES) {
        return json({ ok: false, error: "TOO_MANY_FILES" }, 400);
      }
      for (const file of filesByType.enrollment_form) {
        if (!isAllowedEnrollment(file)) return json({ ok: false, error: "INVALID_FILE" }, 400);
      }
      for (const file of filesByType.trial_screenshot) {
        if (!isAllowedImage(file)) return json({ ok: false, error: "INVALID_FILE" }, 400);
      }
      for (const file of filesByType.verification_image) {
        if (!isAllowedImage(file)) return json({ ok: false, error: "INVALID_FILE" }, 400);
      }
    }

    const admin = dbAdmin();
    const bucket = r2Enabled() ? getR2Bucket() : await resolveBucket(admin);
    if (!bucket) return json({ ok: false, error: "BUCKET_NOT_FOUND" }, 500);

    const now = new Date().toISOString();
    const uploads = [];
    const uploadIds: string[] = [];

    for (const docType of DOC_TYPES) {
      for (let index = 0; index < filesByType[docType].length; index += 1) {
        const file = filesByType[docType][index];
        const uploadId = requestId ? buildUploadRowId(user.id, requestId, docType, index) : randomStamp();
        const storagePath = makeStoragePath(user.id, docType, file, requestId || null, index);
        const buffer = Buffer.from(await file.arrayBuffer());
        await uploadBufferToStorage(
          admin,
          bucket,
          storagePath,
          buffer,
          file.type || "application/octet-stream"
        );
        uploads.push({
          id: uploadId,
          student_id: user.id,
          uploaded_by: user.id,
          doc_type: docType,
          storage_bucket: bucket,
          storage_path: storagePath,
          file_name: file.name || "upload",
          mime_type: file.type || null,
          size_bytes: buffer.length,
          created_at: now
        });
        uploadIds.push(uploadId);
      }
    }

    const ins = await admin.from("student_documents").insert(uploads as any);
    if (ins.error) {
      if (requestId && uploadIds.length) {
        const existing = await admin.from("student_documents").select("id").in("id", uploadIds);
        const existingIds = new Set((existing.data || []).map((row: any) => String(row.id || "")));
        if (uploadIds.every((id) => existingIds.has(id))) {
          invalidateStudentDocumentsCache();
          return json({ ok: true, count: uploads.length, duplicated: true });
        }
      }
      return json({ ok: false, error: ins.error.message }, 500);
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("id,full_name,email,leader_id,created_by")
      .eq("id", user.id)
      .maybeSingle();
    const { data: coachRow } = await admin
      .from("coach_assignments")
      .select("coach_id")
      .eq("assigned_user_id", user.id)
      .maybeSingle();
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "super_admin");

    const targets = new Set<string>();
    if (profile?.leader_id) targets.add(profile.leader_id);
    if (profile?.created_by) targets.add(profile.created_by);
    if (coachRow?.coach_id) targets.add(coachRow.coach_id);
    (admins || []).forEach((row: any) => row?.id && targets.add(row.id));
    targets.delete(user.id);

    if (targets.size) {
      const label = profile?.full_name || profile?.email || user.id.slice(0, 6);
      const content = buildStudentSubmitContent(
        { id: user.id, full_name: profile?.full_name, email: profile?.email, leader_id: profile?.leader_id },
        "已提交学员资料，请及时审核。",
        "submitted student documents. Please review."
      );
      const rows = Array.from(targets).map((id) => ({
        to_user_id: id,
        from_user_id: user.id,
        title: "学员资料已提交",
        content: `学员 ${label} 已提交资料。\n\n${content}`
      }));
      await admin.from("notifications").insert(rows as any);
    }

    invalidateStudentDocumentsCache();
    return json({ ok: true, count: uploads.length });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return json({ ok: false, error: code }, status);
  }
}
