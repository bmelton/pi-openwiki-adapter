// OpenWiki's own bookkeeping files under openwiki/. Read-only; shapes follow openwiki 0.5.x
// (dist/agent/utils.js readLastUpdate, dist/generation/page-manifest.js). Unknown fields are ignored,
// missing files are `undefined`, so older wikis still work with the mtime fallback in freshness.ts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { wikiDir } from "./config.js";

/** `openwiki/.last-update.json`: written at the end of every native or host-driven run. */
export type LastUpdate = {
  updatedAt: string;
  command: "init" | "update";
  model: string;
  gitHead?: string;
  status: "complete" | "interrupted";
  language?: string;
};

/** `openwiki/.page-manifest.json`: per-page durability record; `gitHead` is the source head the page was verified against. */
export type PageManifest = {
  schemaVersion: number;
  pages: Record<string, { gitHead?: string; completedBy?: string; completedRunId?: string }>;
};

export const LAST_UPDATE_BASENAME = ".last-update.json";
export const PAGE_MANIFEST_BASENAME = ".page-manifest.json";
export const CLAIMS_DIRNAME = ".claims";

function readJsonFile<T>(path: string): T | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return undefined; }
}

export function readLastUpdate(cwd: string): LastUpdate | undefined {
  const raw = readJsonFile<Record<string, unknown>>(join(wikiDir(cwd), LAST_UPDATE_BASENAME));
  if (!raw || typeof raw.updatedAt !== "string" || typeof raw.command !== "string" || typeof raw.model !== "string") return undefined;
  return {
    updatedAt: raw.updatedAt,
    command: raw.command === "init" ? "init" : "update",
    model: raw.model,
    gitHead: typeof raw.gitHead === "string" ? raw.gitHead : undefined,
    // metadata written before the status field existed is treated as complete, matching OpenWiki itself
    status: raw.status === "interrupted" ? "interrupted" : "complete",
    language: typeof raw.language === "string" ? raw.language : undefined,
  };
}

export function readPageManifest(cwd: string): PageManifest | undefined {
  const raw = readJsonFile<PageManifest>(join(wikiDir(cwd), PAGE_MANIFEST_BASENAME));
  if (!raw || typeof raw !== "object" || !raw.pages || typeof raw.pages !== "object") return undefined;
  return raw;
}

/** Number of persisted Claims records (files under openwiki/.claims/), or undefined when the wiki has none. */
export function countClaims(cwd: string): number | undefined {
  const dir = join(wikiDir(cwd), CLAIMS_DIRNAME);
  if (!existsSync(dir)) return undefined;
  let n = 0;
  const visit = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) visit(p); else n++; } };
  visit(dir);
  return n;
}
