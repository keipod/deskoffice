import { Cron } from "croner";
import {
  createCronRun,
  finishCronRun,
  getCronJob,
  listCronJobs,
  updateCronJob
} from "./db.js";
import { executeAgentTask, type RuntimeEventEmitter } from "./executor.js";

const handles = new Map<string, Cron>();

export function validateCronSchedule(schedule: string, timezone: string) {
  try {
    const probe = new Cron(schedule, { timezone, paused: true });
    const next = probe.nextRun();
    probe.stop();
    if (!next) return { ok: false as const, error: "schedule_has_no_next_run" };
    return { ok: true as const, nextRunAt: next.toISOString() };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function setNextRun(jobId: string, handle: Cron | null) {
  const next = handle?.nextRun() ?? null;
  updateCronJob(jobId, { nextRunAt: next ? next.toISOString() : null });
}

export async function runCronJob(jobId: string, emit?: RuntimeEventEmitter) {
  const job = getCronJob(jobId);
  if (!job) throw new Error("cron_job_not_found");

  const run = createCronRun(job);
  emit?.("cron", { reason: "run_started", jobId: job.id, runId: run.id });

  try {
    const result = await executeAgentTask(job.agentId, job.prompt, {
      emit,
      context: `This task was triggered by DeskOffice cron job "${job.name}" (${job.schedule}, ${job.timezone}).`
    });
    const finished = finishCronRun(run.id, { result: result.text });
    emit?.("cron", { reason: "run_succeeded", jobId: job.id, runId: run.id });
    return finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finished = finishCronRun(run.id, { error: message });
    emit?.("cron", { reason: "run_failed", jobId: job.id, runId: run.id, error: message });
    return finished;
  } finally {
    const handle = handles.get(job.id) ?? null;
    setNextRun(job.id, handle);
  }
}

export function unscheduleCronJob(jobId: string) {
  const current = handles.get(jobId);
  if (current) current.stop();
  handles.delete(jobId);
}

export function scheduleCronJob(jobId: string, emit?: RuntimeEventEmitter) {
  unscheduleCronJob(jobId);
  const job = getCronJob(jobId);
  if (!job || !job.enabled) {
    if (job) updateCronJob(job.id, { nextRunAt: null });
    return null;
  }

  const validation = validateCronSchedule(job.schedule, job.timezone);
  if (!validation.ok) throw new Error(validation.error);

  const handle = new Cron(
    job.schedule,
    {
      timezone: job.timezone,
      protect: true,
      catch: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        emit?.("cron", { reason: "scheduler_error", jobId: job.id, error: message });
      }
    },
    async () => {
      await runCronJob(job.id, emit);
    }
  );

  handles.set(job.id, handle);
  setNextRun(job.id, handle);
  return handle;
}

export function reloadCronSchedules(emit?: RuntimeEventEmitter) {
  for (const id of handles.keys()) unscheduleCronJob(id);
  for (const job of listCronJobs()) {
    if (!job.enabled) {
      updateCronJob(job.id, { nextRunAt: null });
      continue;
    }
    try {
      scheduleCronJob(job.id, emit);
    } catch (error) {
      emit?.("cron", {
        reason: "invalid_schedule",
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function scheduledCronCount() {
  return handles.size;
}
