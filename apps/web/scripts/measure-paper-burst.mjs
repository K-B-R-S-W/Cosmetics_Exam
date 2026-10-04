import { performance } from "node:perf_hooks";

const baseUrl = (process.env.PAPER_BURST_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const rawCredentials = process.env.PAPER_BURST_CREDENTIALS;

if (!rawCredentials) {
  throw new Error("Set PAPER_BURST_CREDENTIALS to a JSON array of exactly 23 synthetic {mer_code,nic,exam_id?} objects.");
}
const credentials = JSON.parse(rawCredentials);
if (!Array.isArray(credentials) || credentials.length !== 23) {
  throw new Error("PAPER_BURST_CREDENTIALS must contain exactly 23 candidates.");
}

console.warn("WARNING: A successful run moves all 23 attempts to in_progress and cannot be repeated on the same exam.");

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const session = values.map((value) => value.split(";", 1)[0]).find((value) => value.startsWith("exam_session="));
  if (!session) throw new Error("Login did not return an exam_session cookie.");
  return session;
}

async function loginAndCheck(credential, index) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(credential),
  });
  if (!login.ok) throw new Error(`Candidate ${index + 1} login preflight returned HTTP ${login.status}. No paper requests were sent.`);
  const cookie = cookieFrom(login);
  const stateResponse = await fetch(`${baseUrl}/api/exam/state`, { headers: { Cookie: cookie }, cache: "no-store" });
  if (!stateResponse.ok) throw new Error(`Candidate ${index + 1} state preflight returned HTTP ${stateResponse.status}. No paper requests were sent.`);
  const state = await stateResponse.json();
  if (state.phase !== "live" || state.exam?.status !== "live") {
    throw new Error(`Candidate ${index + 1} exam is not live. No paper requests were sent.`);
  }
  if (!state.exam?.ends_at || new Date(state.exam.ends_at).getTime() <= Date.now()) {
    throw new Error(`Candidate ${index + 1} exam ends_at is not in the future. No paper requests were sent.`);
  }
  if (state.attempt?.status !== "acknowledged") {
    throw new Error(`Candidate ${index + 1} attempt is not acknowledged. No paper requests were sent.`);
  }
  return { cookie, examId: state.exam.id };
}

const sessions = await Promise.all(credentials.map(loginAndCheck));
if (new Set(sessions.map((session) => session.examId)).size !== 1) {
  throw new Error("The 23 candidates are not assigned to the same exam. No paper requests were sent.");
}

async function timedPaper(session) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/exam/paper`, {
    headers: { Cookie: session.cookie },
    cache: "no-store",
  });
  await response.arrayBuffer();
  return { durationMs: performance.now() - started, status: response.status };
}

const results = await Promise.all(sessions.map(timedPaper));
const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
const percentile = (fraction) => durations[Math.max(0, Math.ceil(fraction * durations.length) - 1)];
const round = (value) => Math.round(value * 10) / 10;
const slowest = durations.at(-1);
console.log(JSON.stringify({
  parallel_23: {
    p50_ms: round(percentile(0.5)),
    p95_ms: round(percentile(0.95)),
    slowest_ms: round(slowest),
    over_two_seconds: slowest > 2_000,
    statuses: results.map((result) => result.status),
  },
}, null, 2));
