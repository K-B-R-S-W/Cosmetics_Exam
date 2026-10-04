import { hash, verify } from "@node-rs/argon2";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.LOGIN_TIMING_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const pepper = process.env.NIC_PEPPER;
const rawCredentials = process.env.LOGIN_TIMING_CREDENTIALS;

if (!pepper) throw new Error("Set NIC_PEPPER.");

const argonOptions = { algorithm: 2, version: 1, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32, secret: new TextEncoder().encode(pepper) };
const argonStarted = performance.now();
const sampleHash = await hash("200012345678", argonOptions);
const argonHashMs = performance.now() - argonStarted;
const verifyStarted = performance.now();
await verify(sampleHash, "200012345678", { secret: argonOptions.secret });
const argonVerifyMs = performance.now() - verifyStarted;
const round = (value) => Math.round(value * 10) / 10;

if (process.env.LOGIN_TIMING_ARGON_ONLY === "1") {
  console.log(JSON.stringify({ argon_hash_ms: round(argonHashMs), argon_verify_ms: round(argonVerifyMs) }, null, 2));
  process.exit(0);
}
if (!rawCredentials) {
  throw new Error("Set LOGIN_TIMING_CREDENTIALS (a JSON array of 23 {mer_code,nic,exam_id?} objects).");
}
const credentials = JSON.parse(rawCredentials);
if (!Array.isArray(credentials) || credentials.length !== 23) {
  throw new Error("LOGIN_TIMING_CREDENTIALS must contain exactly 23 candidates.");
}

async function timedLogin(credential) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(credential),
  });
  await response.arrayBuffer();
  return { durationMs: performance.now() - started, status: response.status };
}

const single = await timedLogin(credentials[0]);
const parallel = await Promise.all(credentials.map(timedLogin));
const durations = parallel.map((result) => result.durationMs).sort((a, b) => a - b);
const percentile = (value) => durations[Math.max(0, Math.ceil(value * durations.length) - 1)];
console.log(JSON.stringify({
  argon_hash_ms: round(argonHashMs),
  argon_verify_ms: round(argonVerifyMs),
  single_login_ms: round(single.durationMs),
  single_status: single.status,
  parallel_23: {
    p50_ms: round(percentile(0.5)),
    p95_ms: round(percentile(0.95)),
    slowest_ms: round(durations.at(-1)),
    statuses: parallel.map((result) => result.status),
  },
}, null, 2));
