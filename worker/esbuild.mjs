import { build } from "esbuild";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: { index: "src/index.ts", "dry-run": "src/dry-run-cli.ts", "test-prompt": "scripts/test-prompt.ts", "db-smoke": "src/db-smoke.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  tsconfig: "tsconfig.json",
  // Shared web sources must resolve runtime packages from the worker-only install.
  nodePaths: [resolve("node_modules")],
});

await writeFile("dist/package.json", `${JSON.stringify({ type: "commonjs" })}\n`, "utf8");
