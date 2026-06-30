import { dbRun } from "@/lib/d1";

export type JobLockResult = { ok: true } | { ok: false; error: string };

export async function acquireJobLock(jobName: string, lockSeconds: number): Promise<JobLockResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + lockSeconds * 1000).toISOString();
  const res = await dbRun(
    `insert into job_runs (job_name, running, locked_until, last_started_at, last_error)
     values (?, 1, ?, ?, null)
     on conflict(job_name) do update set
       running = 1,
       locked_until = excluded.locked_until,
       last_started_at = excluded.last_started_at,
       last_error = null
     where job_runs.locked_until is null or job_runs.locked_until < ?`,
    [jobName, lockedUntil, nowIso, nowIso]
  );

  const changes = Number((res as any)?.meta?.changes ?? (res as any)?.changes ?? 0);
  if (!changes) return { ok: false, error: "JOB_LOCKED" };
  return { ok: true };
}

export async function releaseJobLock(jobName: string, errorMessage?: string | null) {
  const nowIso = new Date().toISOString();
  await dbRun(
    `update job_runs
     set running = 0,
         locked_until = null,
         last_finished_at = ?,
         last_error = ?
     where job_name = ?`,
    [nowIso, errorMessage ?? null, jobName]
  );
}
