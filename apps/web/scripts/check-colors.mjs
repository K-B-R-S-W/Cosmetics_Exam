import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceDirectories = ["app", "components", "lib", "styles"];
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const rawColorPattern = /#[\da-f]{3,8}\b/gi;
const allowedFile = path.resolve(root, "styles", "tokens.css");
const failures = [];

async function inspect(target) {
  let entries;

  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await inspect(entryPath);
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name)) || entryPath === allowedFile) {
      continue;
    }

    const contents = await readFile(entryPath, "utf8");
    const matches = contents.match(rawColorPattern);

    if (matches) {
      failures.push(`${path.relative(root, entryPath)}: ${[...new Set(matches)].join(", ")}`);
    }
  }
}

for (const directory of sourceDirectories) {
  await inspect(path.join(root, directory));
}

if (failures.length > 0) {
  console.error("Raw colors must be defined in styles/tokens.css only:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
