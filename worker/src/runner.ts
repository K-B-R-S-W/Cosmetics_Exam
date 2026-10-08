import { pacificQuotaWindow } from "../../apps/web/lib/grading/quota-day";
import type { GradingConfig } from "./config";
import { classifyGeminiFailure } from "./errors";
import { callGemini } from "./gemini";
import type { GradingJob, GradingRepository } from "./grader";
import { parseGradingResponse } from "./parser";
import { buildPrompt } from "./prompt";
import { SlotManager } from "./slots";

type RunnerDependencies = {
  repository: GradingRepository; config: GradingConfig; slots: SlotManager;
  fetcher?: typeof fetch; now?: () => Date; retryState?: Map<string, GradingRetry>;
};

export type GradingRetry = { notBefore: number; preferredLabel?: string; excludeLabel?: string };

export type GradingTickResult = { active: boolean; processed: number };

export async function initializeGrading(deps: RunnerDependencies): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  deps.slots.rebuildUsage(await deps.repository.usageSince(pacificQuotaWindow(now).start.toISOString()));
  await deps.repository.resetStuck();
}

async function processJob(deps: RunnerDependencies, job: GradingJob): Promise<void> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const retry = deps.retryState?.get(job.id);
  if (retry && retry.notBefore > nowMs) return;
  const slot = deps.slots.acquire(nowMs, retry?.preferredLabel, retry?.excludeLabel);
  if (!slot) {
    const now = (deps.now ?? (() => new Date()))();
    const allDisabled = deps.slots.slots.length > 0 && deps.slots.slots.every((item) => item.disabled);
    const nextAvailableAt = deps.slots.nextAvailableAt(now.getTime());
    if (!allDisabled && Number.isFinite(nextAvailableAt) && nextAvailableAt - now.getTime() <= deps.config.pauseAfterMin * 60_000) return;
    const reason = allDisabled ? "all_keys_disabled" : "keys_exhausted";
    const next = reason === "keys_exhausted" ? (Number.isFinite(nextAvailableAt) ? new Date(nextAvailableAt) : pacificQuotaWindow(now).next).toISOString() : undefined;
    if (await deps.repository.pauseRun(job.runId, reason, next)) {
      await deps.repository.alert({ type: "grading", severity: "warning", message: reason === "keys_exhausted" ? "Grading is paused until quota is available." : "Grading is paused because all configured keys are disabled.", uniqueKey: `${reason}:${job.runId}` });
    }
    return;
  }
  try {
  if (!await deps.repository.claim(job, slot.label, deps.config.model)) { deps.retryState?.delete(job.id); return; }
  let items;
  try {
    items = await deps.repository.loadItems(job);
  } catch {
    await deps.repository.requeue(job);
    await deps.repository.log({ run_id: job.runId, job_id: job.id, event: "retry", detail: "reason=input_read_failed" });
    return;
  }
  const prompt = buildPrompt(items, deps.config.maxAnswerChars, deps.config.promptVersion);
  let result;
  try { result = await callGemini({ key: slot.key, user: prompt.user, timeoutMs: deps.config.requestTimeoutMs, thinking: deps.config.thinking, fetcher: deps.fetcher }); }
  catch { await recordTransientFailure(deps, job, slot.label, "network_error"); return; }
  if (result.ok || result.status === 200) {
    await deps.repository.log({ run_id: job.runId, job_id: job.id, key_label: slot.label, model: deps.config.model, event: "call", detail: `items=${items.length},latency_ms=${result.latencyMs}` });
    deps.slots.markCall(slot.label, (deps.now ?? (() => new Date()))().getTime());
  }
  if (result.ok) {
    let parsed;
    try { parsed = parseGradingResponse(result.text, prompt.mapping, { markStep: deps.config.markStep, reviewConfidence: deps.config.reviewConfidence, reviewConfidenceSinglish: deps.config.reviewConfidenceSinglish, promptVersion: deps.config.promptVersion }); }
    catch { await deps.repository.split(job, deps.config.maxTries); return; }
    await deps.repository.saveScores(job, parsed.scores, deps.config.model, slot.label);
    if (parsed.missing.length && job.tries + 1 >= deps.config.maxTries) await deps.repository.fail(job, "partial_missing", true, deps.config.maxTries);
    else {
      if (parsed.missing.length) {
        await deps.repository.requeue(job, parsed.missing);
        await deps.repository.log({ run_id: job.runId, job_id: job.id, event: "requeued", detail: `items=${parsed.missing.length}` });
      }
      await deps.repository.complete(job, parsed.missing.length ? `partial:${parsed.missing.length}` : null);
    }
    await deps.repository.recompute(job.attemptId);
    await deps.repository.log({ run_id: job.runId, job_id: job.id, event: "done", detail: `items=${parsed.scores.length},missing=${parsed.missing.length}` });
    deps.retryState?.delete(job.id); return;
  }
  const action = classifyGeminiFailure(result, slot.rateLimits);
  if (action.kind === "rpm") { deps.slots.recordRateLimit(slot.label); const until = (deps.now ?? (() => new Date()))().getTime() + action.cooldownMs; deps.slots.cooldown(slot.label, until); await deps.repository.updateKey(slot.label, "cooldown", new Date(until).toISOString(), "rate_limited"); await deps.repository.requeue(job); await deps.repository.log({ run_id: job.runId, job_id: job.id, key_label: slot.label, model: deps.config.model, event: "rate_limited", detail: `cooldown_ms=${action.cooldownMs}` }); }
  else if (action.kind === "daily") { const until = pacificQuotaWindow((deps.now ?? (() => new Date()))()).next; deps.slots.cooldown(slot.label, until.getTime()); await deps.repository.updateKey(slot.label, "cooldown", until.toISOString(), "daily_quota"); await deps.repository.requeue(job); await deps.repository.log({ run_id: job.runId, job_id: job.id, key_label: slot.label, model: deps.config.model, event: "rate_limited", detail: "quota=daily" }); }
  else if (action.kind === "disable_key") { deps.slots.disable(slot.label); await deps.repository.updateKey(slot.label, "disabled", null, "key_rejected"); await deps.repository.requeue(job); await deps.repository.log({ run_id: job.runId, job_id: job.id, key_label: slot.label, model: deps.config.model, event: "key_disabled", detail: "reason=key_rejected" }); await deps.repository.alert({ type: "grading", severity: "critical", message: `Grading key ${slot.label} is disabled.`, uniqueKey: `key_disabled:${slot.label}` }); }
  else if (action.kind === "model_not_found") { await deps.repository.requeue(job); await deps.repository.pauseAll("model_not_found"); await deps.repository.alert({ type: "grading", severity: "critical", message: "The configured grading model was not found.", uniqueKey: "model_not_found" }); }
  else if (action.kind === "split") await deps.repository.split(job, deps.config.maxTries);
  else if (action.kind === "blocked") { await deps.repository.failPermanently(job, "blocked"); await deps.repository.log({ run_id: job.runId, job_id: job.id, event: "blocked", detail: "reason=safety" }); await deps.repository.alert({ type: "grading", severity: "warning", message: "A grading job needs a manual override.", uniqueKey: `blocked:${job.runId}` }); }
  else { await recordTransientFailure(deps, job, slot.label, "transient"); }
  } finally { deps.slots.release(slot.label); }
}

async function recordTransientFailure(deps: RunnerDependencies, job: GradingJob, slotLabel: string, code: string): Promise<void> {
  const chargedTries = job.tries + 1;
  await deps.repository.fail(job, code, true, deps.config.maxTries);
  if (chargedTries < deps.config.maxTries) {
    const delays = [2_000, 6_000, 20_000];
    const delay = delays[Math.min(job.tries, delays.length - 1)];
    const next: GradingRetry = { notBefore: (deps.now ?? (() => new Date()))().getTime() + delay };
    if (job.tries < 2) next.preferredLabel = slotLabel; else next.excludeLabel = slotLabel;
    deps.retryState?.set(job.id, next);
  } else deps.retryState?.delete(job.id);
  await deps.repository.log({ run_id: job.runId, job_id: job.id, key_label: slotLabel, model: deps.config.model, event: "retry", detail: `tries=${chargedTries}` });
}

export async function runGradingTick(deps: RunnerDependencies): Promise<GradingTickResult> {
  await deps.repository.resumeDue();
  const jobs = await deps.repository.pendingJobs(3);
  const outcomes = await Promise.allSettled(jobs.map((job) => processJob(deps, job)));
  const processed = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
  await deps.repository.finishRuns();
  return { active: await deps.repository.hasWork(), processed };
}
