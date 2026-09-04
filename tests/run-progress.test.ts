import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { formatRunStatusLine, readRunProgress, runStatePath } from "../src/run-progress.js";

const NOW = Date.parse("2026-01-01T00:10:00.000Z");

function repoWithCheckpoint(state: unknown, ageMs = 0): string {
  const dir = mkdtempSync(join(tmpdir(), "ow-run-"));
  mkdirSync(join(dir, "openwiki"), { recursive: true });
  const path = runStatePath(dir);
  writeFileSync(path, typeof state === "string" ? state : JSON.stringify(state));
  const seconds = (NOW - ageMs) / 1000;
  utimesSync(path, seconds, seconds);
  return dir;
}

function page(title: string, status: string) {
  return { id: title, path: `openwiki/${title}.md`, title, purpose: "p", seedPaths: [], relatedPages: [], instructions: [], status };
}

describe("readRunProgress", () => {
  it("reports the planning phase before a plan exists", () => {
    const dir = repoWithCheckpoint({ schemaVersion: 1, runId: "abc", mode: "update", phase: "planning", startedAt: "2026-01-01T00:09:12.000Z" });

    const progress = readRunProgress(dir, NOW)!;

    expect(progress.phase).toBe("planning");
    expect(progress.total).toBe(0);
    expect(progress.live).toBe(true);
    expect(formatRunStatusLine(progress)).toBe("openwiki: update · planning · 0m48s");
  });

  it("counts complete and skipped pages and names the first pending page", () => {
    const dir = repoWithCheckpoint({
      schemaVersion: 1,
      runId: "abc",
      mode: "update",
      phase: "generating",
      startedAt: "2026-01-01T00:05:48.000Z",
      plan: { pages: [page("Overview", "complete"), page("Legacy", "skipped"), page("Architecture", "pending"), page("Testing", "pending")], deletePages: [] },
    });

    const progress = readRunProgress(dir, NOW)!;

    expect(progress).toMatchObject({ done: 2, total: 4, current: "Architecture" });
    expect(formatRunStatusLine(progress)).toBe("openwiki: update · page 3/4 · 4m12s");
  });

  it("marks a checkpoint older than the live window as not live", () => {
    const dir = repoWithCheckpoint({ schemaVersion: 1, runId: "abc", mode: "init", phase: "generating" }, 6 * 60_000);

    expect(readRunProgress(dir, NOW)!.live).toBe(false);
  });

  it("returns undefined for a missing or malformed checkpoint", () => {
    expect(readRunProgress(mkdtempSync(join(tmpdir(), "ow-run-")), NOW)).toBeUndefined();
    expect(readRunProgress(repoWithCheckpoint("{ not json"), NOW)).toBeUndefined();
    expect(readRunProgress(repoWithCheckpoint({ schemaVersion: 1 }), NOW)).toBeUndefined();
  });
});
