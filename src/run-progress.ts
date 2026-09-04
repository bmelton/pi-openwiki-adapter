import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { wikiDir } from "./config.js";
import type { RunProgress } from "./types.js";

/** OpenWiki writes this checkpoint atomically after the plan and after every page, then deletes it on success. */
const RUN_STATE_BASENAME = ".run.json";

// ponytail: mtime freshness stands in for a heartbeat OpenWiki does not write. A page that
// takes longer than this window reads as interrupted. Upgrade to a real heartbeat if OpenWiki adds one.
const LIVE_WINDOW_MS = 5 * 60_000;

export function runStatePath(cwd: string): string {
  return join(wikiDir(cwd), RUN_STATE_BASENAME);
}

export function readRunProgress(cwd: string, now = Date.now()): RunProgress | undefined {
  const path = runStatePath(cwd);
  let raw: any;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object" || typeof raw.runId !== "string") return undefined;

  const pages: any[] = Array.isArray(raw.plan?.pages) ? raw.plan.pages : [];
  const done = pages.filter((page) => page?.status === "complete" || page?.status === "skipped").length;
  const current = pages.find((page) => page?.status === "pending");

  return {
    runId: raw.runId,
    mode: raw.mode === "init" ? "init" : "update",
    phase: raw.phase === "planning" ? "planning" : "generating",
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
    total: pages.length,
    done,
    current: typeof current?.title === "string" ? current.title : undefined,
    checkpointMtime: new Date(mtimeMs).toISOString(),
    live: now - mtimeMs < LIVE_WINDOW_MS,
    elapsedMs: elapsedMs(raw.startedAt, now),
  };
}

/** Compact one-line form for the footer status bar. */
export function formatRunStatusLine(progress: RunProgress): string {
  const stage = progress.phase === "planning" || progress.total === 0 ? progress.phase : `page ${progress.done + 1}/${progress.total}`;
  return [`openwiki: ${progress.mode}`, stage, formatDuration(progress.elapsedMs)].filter(Boolean).join(" · ");
}

/** Multi-line form for tool output and /openwiki doctor. */
export function formatRunProgress(progress: RunProgress): string {
  const lines = [
    `OpenWiki run: ${progress.mode} in progress (${progress.live ? "live" : "no checkpoint write for over 5 minutes, possibly interrupted"})`,
    `Phase: ${progress.phase}`,
  ];
  if (progress.total > 0) lines.push(`Pages: ${progress.done}/${progress.total} done${progress.current ? `, current: ${progress.current}` : ""}`);
  if (progress.startedAt) lines.push(`Started: ${progress.startedAt} (${formatDuration(progress.elapsedMs)} ago)`);
  lines.push(`Checkpoint written: ${progress.checkpointMtime}`);
  lines.push("Generated pages under openwiki/ may change while this run works.");
  return lines.join("\n");
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

function elapsedMs(startedAt: unknown, now: number): number | undefined {
  if (typeof startedAt !== "string") return undefined;
  const started = Date.parse(startedAt);
  return Number.isNaN(started) ? undefined : now - started;
}
