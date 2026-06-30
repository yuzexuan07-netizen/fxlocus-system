import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { dbFirst } from "@/lib/d1";
import { requireAdmin } from "@/lib/system/guard";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { isStrongSystemPassword } from "@/lib/system/passwordPolicy";
import { updateLocalAuthPasswordByUserId } from "@/lib/system/localAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  newPassword: z.string().min(8).max(64).optional()
});

type TargetRow = {
  id: string;
  role: string | null;
};

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function randomStrongPassword(length = 12) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*_-+=?";
  const all = `${upper}${lower}${digits}${special}`;
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const output = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (output.length < length) output.push(pick(all));
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output.join("");
}

export async function POST(req: NextRequest, ctx: { params: { userId: string } }) {
  try {
    const { user } = await requireAdmin();
    const userId = String(ctx?.params?.userId || "").trim();
    if (!userId) return noStoreJson({ ok: false, error: "INVALID_USER" }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_BODY" }, 400);

    if (user.role === "leader") {
      const treeIds = await fetchLeaderTreeIds(user.id);
      if (!treeIds.includes(userId)) return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const target = await dbFirst<TargetRow>("select id, role from profiles where id = ? limit 1", [userId]);
    if (!target?.id) return noStoreJson({ ok: false, error: "NOT_FOUND" }, 404);
    if (String(target.role || "") === "super_admin" && user.role !== "super_admin") {
      return noStoreJson({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const nextPassword = parsed.data.newPassword || randomStrongPassword();
    if (!isStrongSystemPassword(nextPassword)) {
      return noStoreJson({ ok: false, error: "WEAK_PASSWORD" }, 400);
    }

    await updateLocalAuthPasswordByUserId(userId, nextPassword);
    return noStoreJson({ ok: true, newPassword: nextPassword });
  } catch (e: any) {
    const code = String(e?.code || "UNAUTHORIZED");
    const status = code === "FORBIDDEN" ? 403 : code === "FROZEN" ? 403 : 401;
    return noStoreJson({ ok: false, error: code }, status);
  }
}
