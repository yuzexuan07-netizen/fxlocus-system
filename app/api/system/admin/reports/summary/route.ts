import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireManager } from "@/lib/system/guard";
import { fetchAssistantCreatedUserIds } from "@/lib/system/assistantAssignments";
import { fetchCoachAssignedUserIds } from "@/lib/system/coachAssignments";
import { fetchLeaderTreeIds } from "@/lib/system/leaderTree";
import { mapSystemApiError } from "@/lib/system/apiError";
import { isSuperAdmin } from "@/lib/system/roles";
import { dbAdmin } from "@/lib/system/dbAdmin";
import { isDonationStudentStatus } from "@/lib/system/studentStatusValues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SUMMARY_CACHE_TTL_MS = 12_000;
const SUMMARY_CACHE_MAX_KEYS = 2000;
const g = globalThis as {
  __fx_admin_reports_summary_cache?: Map<string, { exp: number; payload: any }>;
};
if (!g.__fx_admin_reports_summary_cache) g.__fx_admin_reports_summary_cache = new Map();
const summaryCache = g.__fx_admin_reports_summary_cache;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function sweepSummaryCache(now: number) {
  if (!summaryCache.size) return;
  for (const [key, value] of summaryCache.entries()) {
    if (value.exp <= now) summaryCache.delete(key);
  }
  if (summaryCache.size <= SUMMARY_CACHE_MAX_KEYS) return;
  const overflow = summaryCache.size - SUMMARY_CACHE_MAX_KEYS;
  let removed = 0;
  for (const key of summaryCache.keys()) {
    summaryCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

const LeaderIdParam = z.string().trim().min(1).max(128);

const COURSE_STATUSES = ["requested", "approved", "rejected", "completed"] as const;
const OPEN_COURSE_STATUSES = ["approved", "completed"] as const;
const LEARNER_ROLES = ["student", "trader", "leader", "coach"] as const;
const DEFAULT_STUDENT_STATUS = "\u666e\u901a\u5b66\u5458";

type InTrainingStudentRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  student_status: string;
  status: string;
  leader_id: string;
  reasons: Array<"role" | "donation" | "course">;
};

function buildInTrainingStudents(
  profileRows: Array<{
    id?: string | null;
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
    status?: string | null;
    student_status?: string | null;
    leader_id?: string | null;
  }>,
  openCourseRows: Array<{ user_id?: string | null }>
) {
  const openCourseUserIds = new Set(
    openCourseRows
      .map((row) => String(row.user_id || ""))
      .filter(Boolean)
  );

  return profileRows.reduce<InTrainingStudentRow[]>((items, row) => {
    const id = String(row.id || "");
    const accountStatus = String(row.status || "active");
    if (!id || accountStatus === "frozen" || accountStatus === "deleted") return items;

    const role = String(row.role || "");
    const includedByRole = role === "trader" || role === "leader";
    const includedByDonation = isDonationStudentStatus(row.student_status);
    const includedByCourse = openCourseUserIds.has(id);
    if (!includedByRole && !includedByDonation && !includedByCourse) return items;

    const reasons: InTrainingStudentRow["reasons"] = [];
    if (includedByRole) reasons.push("role");
    if (includedByDonation) reasons.push("donation");
    if (includedByCourse) reasons.push("course");

    items.push({
      id,
      name: String(row.full_name || ""),
      email: String(row.email || ""),
      role,
      student_status: String(row.student_status || DEFAULT_STUDENT_STATUS),
      status: accountStatus,
      leader_id: String(row.leader_id || ""),
      reasons
    });
    return items;
  }, []);
}

function emptyOverview(role: "coach" | "assistant") {
  return {
    ok: true,
    role,
    scope: { leaderId: null },
    students: { total: 0, frozen: 0, inTraining: 0, byStatus: {} },
    inTrainingStudents: [],
    leaders: { total: 0 },
    traders: { total: 0 },
    coaches: { total: 0 },
    assistants: { total: 0 },
    leaderTeams: [],
    courses: { requested: 0, approved: 0, rejected: 0, completed: 0 },
    pending: { courseAccessRequests: 0, fileAccessRequests: 0 },
    records: { donate: 0, contact: 0, enrollment: 0, subscribe: 0 },
    downloads: { total: 0 },
    ladder: { requested: 0, approved: 0, rejected: 0 },
    generatedAt: new Date().toISOString()
  };
}

type LeaderTeamRow = {
  leader_id: string;
  leader_name: string;
  leader_email: string;
  students: number;
  traders: number;
  leaders: number;
};

export async function GET(req: NextRequest) {
  try {
    const { user, db: scopedDb } = await requireManager();
    const admin = dbAdmin();
    const db = user.role === "coach" || user.role === "assistant" ? admin : scopedDb;
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const leaderIdRaw = req.nextUrl.searchParams.get("leaderId");
    const leaderId =
      leaderIdRaw && isSuperAdmin(user.role)
        ? LeaderIdParam.safeParse(leaderIdRaw).success
          ? leaderIdRaw
          : null
        : null;
    const scopeLeaderIdHint = user.role === "leader" ? user.id : leaderId;
    const cacheKey = `${user.id}:${user.role}:${scopeLeaderIdHint || ""}`;
    const cacheSuccess = (payload: any) => {
      if (!fresh && payload?.ok === true) {
        summaryCache.set(cacheKey, { exp: Date.now() + SUMMARY_CACHE_TTL_MS, payload });
      }
      return json(payload);
    };
    if (!fresh) {
      const now = Date.now();
      sweepSummaryCache(now);
      const cached = summaryCache.get(cacheKey);
      if (cached && cached.exp > now) {
        return json(cached.payload);
      }
    }

    if (user.role === "coach") {
      const assignedIds = await fetchCoachAssignedUserIds(user.id);
      if (!assignedIds.length) {
        return cacheSuccess(emptyOverview("coach"));
      }

      const { data: profileRows, error: profileErr } = await db
        .from("profiles")
        .select("id,full_name,email,role,student_status,status,leader_id")
        .in("id", assignedIds);
      if (profileErr) return json({ ok: false, error: profileErr.message }, 500);

      const byStudentStatus: Record<string, number> = {};
      let studentsTotal = 0;
      let studentsFrozen = 0;
      let tradersTotal = 0;

      (profileRows || []).forEach((row: any) => {
        const role = String(row.role || "");
        if (role !== "student" && role !== "trader") return;
        const key = String(row.student_status || DEFAULT_STUDENT_STATUS);
        byStudentStatus[key] = Number(byStudentStatus[key] || 0) + 1;
        studentsTotal += 1;
        if (row.status === "frozen") studentsFrozen += 1;
        if (role === "trader") tradersTotal += 1;
      });

      const [courseRes, fileRes] = await Promise.all([
        db
          .from("course_access")
          .select("user_id,course_id,status")
          .in("user_id", assignedIds),
        db
          .from("file_access_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "requested")
          .in("user_id", assignedIds)
      ]);
      const { data: courseRows, error: courseErr } = courseRes as any;
      if (courseErr) return json({ ok: false, error: courseErr.message }, 500);
      const inTrainingStudents = buildInTrainingStudents(
        (profileRows || []) as any[],
        (courseRows || []).filter(
          (row: any) => (OPEN_COURSE_STATUSES as readonly string[]).includes(String(row.status || ""))
        )
      );
      const inTraining = inTrainingStudents.length;

      const courses: Record<(typeof COURSE_STATUSES)[number], number> = {
        requested: 0,
        approved: 0,
        rejected: 0,
        completed: 0
      };

      (courseRows || []).forEach((row: any) => {
        const status = String(row.status || "");
        if ((COURSE_STATUSES as readonly string[]).includes(status)) {
          (courses as any)[status] = Number((courses as any)[status] || 0) + 1;
        }
      });

      const { count: fileCount, error: fileErr } = fileRes as any;
      if (fileErr) return json({ ok: false, error: fileErr.message }, 500);

      return cacheSuccess({
        ok: true,
        role: "coach",
        scope: { leaderId: null },
        students: { total: studentsTotal, frozen: studentsFrozen, inTraining, byStatus: byStudentStatus },
        inTrainingStudents,
        leaders: { total: 0 },
        traders: { total: tradersTotal },
        coaches: { total: 0 },
        assistants: { total: 0 },
        leaderTeams: [],
        courses,
        pending: { courseAccessRequests: courses.requested, fileAccessRequests: Number(fileCount || 0) },
        records: { donate: 0, contact: 0, enrollment: 0, subscribe: 0 },
        downloads: { total: 0 },
        ladder: { requested: 0, approved: 0, rejected: 0 },
        generatedAt: new Date().toISOString()
      });
    }

    if (user.role === "assistant") {
      let createdIds: string[] = [];
      try {
        createdIds = await fetchAssistantCreatedUserIds(user.id);
      } catch (err: any) {
        const message = String(err?.message || "");
        const warning = message.includes("created_by")
          ? "profiles_created_by_missing"
          : message || "ASSISTANT_SCOPE_FAILED";
        return cacheSuccess({ ...emptyOverview("assistant"), warning });
      }
      if (!createdIds.length) {
        return cacheSuccess(emptyOverview("assistant"));
      }

      const { data: profileRows, error: profileErr } = await db
        .from("profiles")
        .select("id,full_name,email,role,student_status,status,leader_id")
        .in("id", createdIds);
      if (profileErr) return json({ ok: false, error: profileErr.message }, 500);

      const byStudentStatus: Record<string, number> = {};
      let studentsTotal = 0;
      let studentsFrozen = 0;
      let tradersTotal = 0;

      (profileRows || []).forEach((row: any) => {
        const role = String(row.role || "");
        if (role !== "student" && role !== "trader") return;
        const key = String(row.student_status || DEFAULT_STUDENT_STATUS);
        byStudentStatus[key] = Number(byStudentStatus[key] || 0) + 1;
        studentsTotal += 1;
        if (row.status === "frozen") studentsFrozen += 1;
        if (role === "trader") tradersTotal += 1;
      });

      const [courseRes, fileRes] = await Promise.all([
        db
          .from("course_access")
          .select("user_id,course_id,status")
          .in("user_id", createdIds),
        db
          .from("file_access_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "requested")
          .in("user_id", createdIds)
      ]);
      const { data: courseRows, error: courseErr } = courseRes as any;
      if (courseErr) return json({ ok: false, error: courseErr.message }, 500);
      const inTrainingStudents = buildInTrainingStudents(
        (profileRows || []) as any[],
        (courseRows || []).filter(
          (row: any) => (OPEN_COURSE_STATUSES as readonly string[]).includes(String(row.status || ""))
        )
      );
      const inTraining = inTrainingStudents.length;

      const courses: Record<(typeof COURSE_STATUSES)[number], number> = {
        requested: 0,
        approved: 0,
        rejected: 0,
        completed: 0
      };

      (courseRows || []).forEach((row: any) => {
        const status = String(row.status || "");
        if ((COURSE_STATUSES as readonly string[]).includes(status)) {
          (courses as any)[status] = Number((courses as any)[status] || 0) + 1;
        }
      });

      const { count: fileCount, error: fileErr } = fileRes as any;
      if (fileErr) return json({ ok: false, error: fileErr.message }, 500);

      return cacheSuccess({
        ok: true,
        role: "assistant",
        scope: { leaderId: null },
        students: { total: studentsTotal, frozen: studentsFrozen, inTraining, byStatus: byStudentStatus },
        inTrainingStudents,
        leaders: { total: 0 },
        traders: { total: tradersTotal },
        coaches: { total: 0 },
        assistants: { total: 0 },
        leaderTeams: [],
        courses,
        pending: { courseAccessRequests: courses.requested, fileAccessRequests: Number(fileCount || 0) },
        records: { donate: 0, contact: 0, enrollment: 0, subscribe: 0 },
        downloads: { total: 0 },
        ladder: { requested: 0, approved: 0, rejected: 0 },
        generatedAt: new Date().toISOString()
      });
    }

    const scopeLeaderId = user.role === "leader" ? user.id : leaderId;
    const scopeTreeIds = scopeLeaderId ? await fetchLeaderTreeIds(scopeLeaderId) : null;

    const scopedLearnersPromise =
      scopeTreeIds && !scopeTreeIds.length
        ? Promise.resolve({ data: [], error: null } as any)
        : scopeTreeIds
          ? db
              .from("profiles")
              .select("id,full_name,email,role,student_status,status,leader_id")
              .in("role", [...LEARNER_ROLES])
              .in("id", scopeTreeIds)
          : db
              .from("profiles")
              .select("id,full_name,email,role,student_status,status,leader_id")
              .in("role", [...LEARNER_ROLES]);

    const openCoursePromise =
      scopeTreeIds && !scopeTreeIds.length
        ? Promise.resolve({ data: [], error: null } as any)
        : scopeTreeIds
          ? db
              .from("course_access")
              .select("user_id")
              .in("status", [...OPEN_COURSE_STATUSES])
              .in("user_id", scopeTreeIds)
          : db
              .from("course_access")
              .select("user_id")
              .in("status", [...OPEN_COURSE_STATUSES]);

    const [studentCounts, courseCounts, filePending, scopedLearnersRes, openCourseRes] = await Promise.all([
      db.rpc(
        "report_student_status_counts",
        scopeLeaderId ? ({ _leader_id: scopeLeaderId } as any) : ({} as any)
      ),
      db.rpc(
        "report_course_access_status_counts",
        scopeLeaderId ? ({ _leader_id: scopeLeaderId } as any) : ({} as any)
      ),
      db.rpc(
        "report_pending_file_access_requests",
        scopeLeaderId ? ({ _leader_id: scopeLeaderId } as any) : ({} as any)
      ),
      scopedLearnersPromise,
      openCoursePromise
    ]);
    if (studentCounts.error) return json({ ok: false, error: studentCounts.error.message }, 500);
    if (courseCounts.error) return json({ ok: false, error: courseCounts.error.message }, 500);
    if (filePending.error) return json({ ok: false, error: filePending.error.message }, 500);
    if (scopedLearnersRes.error) return json({ ok: false, error: scopedLearnersRes.error.message }, 500);
    if (openCourseRes.error) return json({ ok: false, error: openCourseRes.error.message }, 500);

    const byStudentStatus: Record<string, number> = {};
    let studentsTotal = 0;
    let studentsFrozen = 0;

    for (const row of (studentCounts.data || []) as any[]) {
      const key = String(row.student_status || DEFAULT_STUDENT_STATUS);
      const total = Number(row.total || 0);
      const frozen = Number(row.frozen || 0);
      byStudentStatus[key] = total;
      studentsTotal += total;
      studentsFrozen += frozen;
    }
    const inTrainingStudents = buildInTrainingStudents(
      (scopedLearnersRes.data || []) as any[],
      (openCourseRes.data || []) as any[]
    );
    const inTraining = inTrainingStudents.length;

    let tradersTotal = 0;
    let leadersTotal = 0;
    let coachesTotal = 0;
    let assistantsTotal = 0;
    let leaderTeams: LeaderTeamRow[] = [];

    if (scopeTreeIds) {
      const subTreeIds = scopeTreeIds.filter((id: string) => id !== scopeLeaderId);
      const [traderRes, coachRes, leaderRes, assistantRes] = await Promise.all([
        subTreeIds.length
          ? db
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "trader")
              .in("id", subTreeIds)
          : Promise.resolve({ count: 0, error: null } as any),
        subTreeIds.length
          ? db
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "coach")
              .in("id", subTreeIds)
          : Promise.resolve({ count: 0, error: null } as any),
        subTreeIds.length
          ? db
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "leader")
              .in("id", subTreeIds)
          : Promise.resolve({ count: 0, error: null } as any),
        scopeLeaderId
          ? admin
              .from("profiles")
              .select("id", { count: "exact", head: true })
              .eq("role", "assistant")
              .eq("created_by", scopeLeaderId)
          : Promise.resolve({ count: 0, error: null } as any)
      ]);
      if (traderRes.error) return json({ ok: false, error: traderRes.error.message }, 500);
      tradersTotal = Number(traderRes.count || 0);

      if (coachRes.error) return json({ ok: false, error: coachRes.error.message }, 500);
      coachesTotal = Number(coachRes.count || 0);

      if (leaderRes.error) return json({ ok: false, error: leaderRes.error.message }, 500);
      leadersTotal = Number(leaderRes.count || 0);
      if (assistantRes.error) return json({ ok: false, error: assistantRes.error.message }, 500);
      assistantsTotal = Number(assistantRes.count || 0);
    } else {
      const [traderRes, coachRes, assistantRes] = await Promise.all([
        db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "trader"),
        db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "coach"),
        db
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "assistant")
      ]);
      if (traderRes.error) return json({ ok: false, error: traderRes.error.message }, 500);
      tradersTotal = Number(traderRes.count || 0);
      if (coachRes.error) return json({ ok: false, error: coachRes.error.message }, 500);
      coachesTotal = Number(coachRes.count || 0);
      if (assistantRes.error) return json({ ok: false, error: assistantRes.error.message }, 500);
      assistantsTotal = Number(assistantRes.count || 0);
    }

    if (isSuperAdmin(user.role) && !scopeLeaderId) {
      const [leadersRes, orgRes] = await Promise.all([
        db
          .from("profiles")
          .select("id,full_name,email")
          .eq("role", "leader")
          .order("created_at", { ascending: false })
          .limit(2000),
        db
          .from("profiles")
          .select("id,leader_id,role")
          .in("role", ["leader", ...LEARNER_ROLES])
          .limit(20000)
      ]);
      const { data: leaders, error: leadersErr } = leadersRes as any;
      if (leadersErr) return json({ ok: false, error: leadersErr.message }, 500);
      const leaderList = leaders || [];
      leadersTotal = leaderList.length;
      const { data: orgRows, error: orgErr } = orgRes as any;
      if (orgErr) return json({ ok: false, error: orgErr.message }, 500);

      const roleById = new Map<string, string>();
      const childrenByLeader = new Map<string, string[]>();
      (orgRows || []).forEach((row: any) => {
        const id = String(row.id || "");
        if (!id) return;
        roleById.set(id, String(row.role || ""));
        const parent = row.leader_id ? String(row.leader_id) : "";
        if (!parent) return;
        const list = childrenByLeader.get(parent) || [];
        list.push(id);
        childrenByLeader.set(parent, list);
      });

      const memo = new Map<string, { students: number; traders: number; leaders: number }>();
      const countSubtree = (rootId: string) => {
        if (memo.has(rootId)) return memo.get(rootId)!;
        const counts = { students: 0, traders: 0, leaders: 0 };
        const children = childrenByLeader.get(rootId) || [];
        children.forEach((childId) => {
          const role = roleById.get(childId);
          if (role === "leader") counts.leaders += 1;
          if (role === "trader") {
            counts.students += 1;
            counts.traders += 1;
          } else if (role === "student" || role === "coach") {
            counts.students += 1;
          }
          const childCounts = countSubtree(childId);
          counts.students += childCounts.students;
          counts.traders += childCounts.traders;
          counts.leaders += childCounts.leaders;
        });
        memo.set(rootId, counts);
        return counts;
      };

      leaderTeams = leaderList.map((leader: any) => {
        const current = countSubtree(String(leader.id));
        return {
          leader_id: leader.id,
          leader_name: leader.full_name || "",
          leader_email: leader.email || "",
          students: current.students,
          traders: current.traders,
          leaders: current.leaders
        };
      });
    } else if (isSuperAdmin(user.role) && !scopeTreeIds) {
      const { count, error: leaderCountErr } = await db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "leader");
      if (!leaderCountErr) leadersTotal = Number(count || 0);
    }

    const courses: Record<(typeof COURSE_STATUSES)[number], number> = {
      requested: 0,
      approved: 0,
      rejected: 0,
      completed: 0
    };

    for (const row of (courseCounts.data || []) as any[]) {
      const st = String(row.status || "");
      if ((COURSE_STATUSES as readonly string[]).includes(st)) {
        (courses as any)[st] = Number(row.total || 0);
      }
    }

    const pendingFileAccessRequests = Number((filePending.data as any[])?.[0]?.total || 0);

    const records = { donate: 0, contact: 0, enrollment: 0, subscribe: 0 };
    const downloads = { total: 0 };
    const ladder = { requested: 0, approved: 0, rejected: 0 };

    if (isSuperAdmin(user.role)) {
      const recordCountsPromise = Promise.all(
        (Object.keys(records) as Array<keyof typeof records>).map((type) =>
          db.from("records").select("id", { count: "exact", head: true }).eq("type", type)
        )
      );
      const downloadsPromise = db.from("file_download_logs").select("id", { count: "exact", head: true });
      const ladderCountsPromise = Promise.all(
        (Object.keys(ladder) as Array<keyof typeof ladder>).map((status) =>
          db.from("ladder_authorizations").select("user_id", { count: "exact", head: true }).eq("status", status)
        )
      );
      const [recordCounts, downloadsRes, ladderCounts] = await Promise.all([
        recordCountsPromise,
        downloadsPromise,
        ladderCountsPromise
      ]);
      for (let i = 0; i < recordCounts.length; i += 1) {
        const res: any = recordCounts[i];
        if (res?.error) return json({ ok: false, error: res.error.message }, 500);
        const key = (Object.keys(records) as Array<keyof typeof records>)[i];
        records[key] = Number(res?.count || 0);
      }
      if (downloadsRes.error) return json({ ok: false, error: downloadsRes.error.message }, 500);
      downloads.total = Number(downloadsRes.count || 0);
      for (let i = 0; i < ladderCounts.length; i += 1) {
        const res: any = ladderCounts[i];
        if (res?.error) return json({ ok: false, error: res.error.message }, 500);
        const key = (Object.keys(ladder) as Array<keyof typeof ladder>)[i];
        ladder[key] = Number(res?.count || 0);
      }
    }

    return cacheSuccess({
      ok: true,
      role: user.role,
      scope: { leaderId: scopeLeaderId || null },
      students: { total: studentsTotal, frozen: studentsFrozen, inTraining, byStatus: byStudentStatus },
      inTrainingStudents,
      leaders: { total: leadersTotal },
      traders: { total: tradersTotal },
      coaches: { total: coachesTotal },
      assistants: { total: assistantsTotal },
      leaderTeams,
      courses,
      pending: { courseAccessRequests: courses.requested, fileAccessRequests: pendingFileAccessRequests },
      records,
      downloads,
      ladder,
      generatedAt: new Date().toISOString()
    });
  } catch (e: any) {
    const mapped = mapSystemApiError(e);
    return json({ ok: false, error: mapped.code }, mapped.status);
  }
}




