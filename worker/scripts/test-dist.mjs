import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryRoot = await mkdtemp(join(tmpdir(), "exam-worker-dist-"));
const copiedDist = join(temporaryRoot, "dist");
const requiredBundles = ["index.js", "dry-run.js", "test-prompt.js", "db-smoke.js"];

try {
  const distEntries = await readdir(resolve("dist"));
  for (const bundle of requiredBundles) {
    if (!distEntries.includes(bundle)) {
      throw new Error(`Worker dist is missing ${bundle}.`);
    }
  }
  const cjsArtifacts = distEntries.filter((entry) => entry.endsWith(".cjs"));
  if (cjsArtifacts.length > 0) {
    throw new Error(`Worker dist contains stale CommonJS artifacts: ${cjsArtifacts.join(", ")}.`);
  }
  for (const bundle of requiredBundles) {
    const source = await readFile(resolve("dist", bundle), "utf8");
    if (/require\(["'](?:zod|sanitize-html)["']\)/u.test(source)) {
      throw new Error(`${bundle} contains an unresolved shared dependency require.`);
    }
  }

  await cp(resolve("dist"), copiedDist, { recursive: true });
  const result = spawnSync(process.execPath, [join(copiedDist, "index.js")], {
    cwd: temporaryRoot,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      WORKER_SELF_TEST: "1",
      SUPABASE_URL: "https://self-test.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-self-test-service-role-key",
    },
  });

  if (
    result.error
    || result.status !== 0
    || result.signal
    || !result.stdout.includes("WORKER DIST FOUR-LANE SELF-TEST PASSED")
    || !result.stdout.includes("WORKER DIST SELF-TEST PASSED")
  ) {
    throw new Error([
      "Worker dist self-test failed.",
      `status=${String(result.status)}`,
      `signal=${String(result.signal)}`,
      `stdout=${result.stdout.trim()}`,
      `stderr=${result.stderr.trim()}`,
      result.error?.message || "",
    ].filter(Boolean).join(" "));
  }

  console.info("WORKER DIST SELF-TEST PASSED");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
