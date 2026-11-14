import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// No source-store fallback is ever installed in the real checkout. Materialize
// the exact checkpoint, overlay only UI-owned files, then fake server ports here.
const project = process.cwd();
const artifacts = path.join(os.homedir(), ".codex", "artifacts", "taskboard-wiki-p2-20261104");
const checkpoint = JSON.parse(readFileSync(path.join(artifacts, "CHECKPOINT.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(artifacts, "PACKAGES.json"), "utf8"));
const owned: string[] = manifest.packages.find((entry: { name: string }) => entry.name === "ui").files;
const scratch = path.resolve(process.env.TASKBOARD_WIKI_UI_SANDBOX ?? path.join(artifacts, "ui-sandbox/app"));
if (scratch.toLowerCase().startsWith(path.resolve(project).toLowerCase() + path.sep) || scratch === path.resolve(project)) throw new Error("Wiki sandbox must be external to the checkout.");
if (!scratch.toLowerCase().startsWith(path.join(artifacts, "ui-sandbox").toLowerCase() + path.sep)) throw new Error("Sandbox must be inside this package's ui-sandbox directory.");
if (process.argv.includes("--real")) {
  const database = new URL(process.env.DATABASE_URL || "http://invalid");
  const name = process.env.TASKBOARD_VISUAL_DATABASE_NAME;
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.search || database.hash || !["localhost", "127.0.0.1"].includes(database.hostname) || !name || !/^taskboard_visual_test_wiki_p2_(ui|int)(_[a-z0-9_]+)?$/.test(name) || decodeURIComponent(database.pathname.slice(1)) !== name) throw new Error("Real mode requires an explicitly provisioned package/integration localhost database with a matching name.");
  if (existsSync(path.join(project, ".wiki-p2-ui-fixture.json"))) throw new Error("Real mode refuses fixture sandboxes.");
  console.log(`REAL app, no mocks; cwd: ${project}; database: ${name}; port: ${process.env.TASKBOARD_VISUAL_TEST_PORT || 3243}. Run npx --no-install playwright test --config playwright.wiki-p2.config.ts with TASKBOARD_WIKI_P2_REAL=1 after server/editor/UI merge.`);
  execFileSync(process.execPath, [path.join(project, "node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.wiki-p2.config.ts"], { cwd: project, stdio: "inherit", env: { ...process.env, TASKBOARD_WIKI_P2_REAL: "1" } });
  process.exit(0);
}
const syncing = process.argv.includes("--sync");
if (existsSync(scratch) && !syncing) throw new Error("Choose a fresh sandbox directory; existing directories are never overwritten.");
if (syncing) {
  const previous = JSON.parse(readFileSync(path.join(artifacts, "UI-P2-SANDBOX.json"), "utf8"));
  if (scratch !== previous.scratch || previous.checkpoint !== checkpoint.commit) throw new Error("Sync requires this run's recorded fixture sandbox and checkpoint.");
}
mkdirSync(scratch, { recursive: true });
const archive = path.join(scratch, "checkpoint.tar");
if (!syncing) {
  execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.eol=lf", "archive", checkpoint.commit, "--format=tar", "-o", archive], { cwd: project });
  execFileSync("tar", ["-xf", "checkpoint.tar"], { cwd: scratch });
}
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: project, encoding: "utf8" }).split("\0").filter(Boolean);
const isOwned = (file: string) => owned.some(pattern => pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : pattern.endsWith("*.ts") ? file.startsWith(pattern.slice(0, -4)) && file.endsWith(".ts") : pattern === file);
for (const file of candidates.filter(isOwned)) {
  const dest = path.join(scratch, file); mkdirSync(path.dirname(dest), { recursive: true }); copyFileSync(path.join(project, file), dest);
}
const put = (file: string, text: string) => { writeFileSync(path.join(scratch, file), text, "utf8"); };
put(".wiki-p2-ui-fixture.json", JSON.stringify({ externalSandbox: true, checkpoint: checkpoint.commit }));
put("src/lib/wiki-store.ts", readFileSync(path.join(project, "tests/fixtures/wiki-ui/store.ts"), "utf8").replace('"./state"', '"../../tests/fixtures/wiki-ui/state"'));
put("src/components/wiki/wiki-loaders.ts", `import { notFound } from "next/navigation";
import { NotesNotFoundError } from "@/lib/notes-errors";
export async function wikiUser() { return { id: "60000000-0000-4000-8000-000000000001", email: "writer@example.invalid", displayName: "Example writer", authMode: "password" as const }; }
export async function wikiLoad<T>(load: () => Promise<T>): Promise<T> { try { return await load(); } catch(error) { if (error instanceof NotesNotFoundError) notFound(); throw error; } }
`);
put("src/app/wiki/page.tsx", readFileSync(path.join(project, "src/app/wiki/page.tsx"), "utf8").replace('import { listAccessibleBoards } from "@/lib/taskboard-store";', 'const listAccessibleBoards = async (_user: unknown) => ({ boards: [] as import("@/lib/board-access").AccessibleBoardSummary[] });'));
put("src/app/notes/page.tsx", 'export const dynamic = "force-dynamic"; export { default } from "../../../tests/fixtures/wiki-ui/notes";');
// The proxy is the authentication port in this deterministic app. Production
// authentication is exercised only in the later integrated-app gate.
put("src/proxy.ts", 'import { NextResponse, type NextRequest } from "next/server"; export function proxy(request: NextRequest) { void request; return NextResponse.next(); }');
// Keep font acquisition independent of internet availability in the sandbox.
const rootLayout = readFileSync(path.join(scratch, "src/app/layout.tsx"), "utf8").replace(/import \{ IBM_Plex_Mono, Public_Sans \} from "next\/font\/google";\r?\n/, "").replace(/const sans = Public_Sans\([\s\S]*?\n\}\);/, 'const sans = { variable: "" };').replace(/const mono = IBM_Plex_Mono\([\s\S]*?\n\}\);/, 'const mono = { variable: "" };');
put("src/app/layout.tsx", rootLayout);
const run = (args: string[]) => {
  const result = process.platform === "win32" ? spawnSync("cmd.exe", ["/d", "/c", ...args], { cwd: scratch, encoding: "utf8", stdio: "inherit" }) : spawnSync(args[0], args.slice(1), { cwd: scratch, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Sandbox command failed: ${args.join(" ")}`);
};
console.log(`Wiki fixture sandbox: ${scratch}\nCheckpoint: ${checkpoint.commit}\nFake boundaries: authenticated identity/proxy, wiki store loaders, browser HTTP interception. No DB or production evidence.\nCleanup: remove only this printed external scratch directory after reviewing artifacts.`);
writeFileSync(path.join(artifacts, "UI-P2-SANDBOX.json"), JSON.stringify({ scratch, checkpoint: checkpoint.commit, createdAt: new Date().toISOString(), fakeBoundaries: ["identity/proxy", "wiki store loaders", "intercepted browser HTTP"], noDatabase: true }, null, 2));
if (!existsSync(path.join(scratch, "node_modules"))) symlinkSync(path.join(project, "node_modules"), path.join(scratch, "node_modules"), "junction");
if (!process.argv.includes("--prepare-only")) {
  run(["npx", "--no-install", "tsc", "--noEmit", "--incremental", "false"]);
  run(["node", "--import", "tsx", "--test", "tests/wiki-ui.test.tsx", "tests/wiki-p2-ui.test.tsx"]);
}
