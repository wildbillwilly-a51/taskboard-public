import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const project = process.cwd();
const artifacts = path.join(os.homedir(), ".codex/artifacts/taskboard-wiki-p2-20261104");
const scratch = path.join(artifacts, "editor-sandbox");
const checkpoint = JSON.parse(readFileSync(path.join(artifacts, "CHECKPOINT.json"), "utf8"));
const marker = path.join(scratch, ".wiki-p2-editor-fixture.json");
if (existsSync(scratch) && (!existsSync(marker) || JSON.parse(readFileSync(marker, "utf8")).project !== project)) throw new Error("Sandbox exists without this package's ownership marker.");
if (!existsSync(scratch)) {
  mkdirSync(scratch, { recursive: true });
  const archive = path.join(scratch, "checkpoint.tar");
  execFileSync("git", ["archive", checkpoint.commit, "--format=tar", "-o", archive]);
  execFileSync("tar", ["-xf", "checkpoint.tar"], { cwd: scratch });
  symlinkSync(path.join(project, "node_modules"), path.join(scratch, "node_modules"), "junction");
}
const manifest = JSON.parse(readFileSync(path.join(artifacts, "PACKAGES.json"), "utf8"));
const owned: string[] = manifest.packages.find((item: { name: string }) => item.name === "editor").files;
const matches = (file: string) => owned.some(pattern => new RegExp(`^${pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(file));
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const file of candidates.filter(matches)) {
  const dest = path.join(scratch, file); mkdirSync(path.dirname(dest), { recursive: true }); copyFileSync(path.join(project, file), dest);
}
const put = (file: string, text: string) => { const dest = path.join(scratch, file); mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, text, "utf8"); };
put("src/app/editor/page.tsx", `import Fixture from "../../../tests/fixtures/wiki-p2-editor/page";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}: {searchParams: Promise<Record<string,string>>}) { return <Fixture query={new URLSearchParams(await searchParams).toString()} />; }`);
put("src/proxy.ts", 'import { NextResponse } from "next/server"; export function proxy() { return NextResponse.next(); }');
put("src/app/layout.tsx", `import "./globals.css"; import "./skins/editor-scale.css"; import "./mobile.css";
export const viewport = { interactiveWidget: "resizes-content" };
export default function Layout({children}: {children: React.ReactNode}) {return <html lang="en" data-theme="light"><body>{children}</body></html>;}`);
put("next.config.ts", 'import type { NextConfig } from "next"; const config: NextConfig = {}; export default config;');
put(".wiki-p2-editor-fixture.json", JSON.stringify({ externalSandbox: true, project, checkpoint: checkpoint.commit }));
writeFileSync(path.join(artifacts, "EDITOR-SANDBOX.json"), JSON.stringify({ scratch, project, checkpoint: checkpoint.commit, fakeBoundaries: ["fixture route", "proxy", "browser discovery interception"], noDatabase: true }, null, 2));
console.log(`Editor sandbox cwd: ${scratch}\nCheckpoint: ${checkpoint.commit}\nDependencies: junction to this editor worktree only. No DB or production env.\nRun from ${project}: npx --no-install playwright test --config playwright.wiki-p2-editor.config.ts`);
