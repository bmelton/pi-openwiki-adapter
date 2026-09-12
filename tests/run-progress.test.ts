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

/** Shaped exactly like openwiki 0.5.1's RepositoryRunStateSchema (dist/generation/run-state.js), so schema drift shows up here. */
const REAL_0_5_1_STATE = {
  schemaVersion: 1,
  runId: "5d9d3a4e-7b2f-4b8e-9a1c-2f3e4d5c6b7a",
  mode: "update",
  phase: "generating",
  startedAt: "2026-01-01T00:04:00.000Z",
  language: "en",
  languageChanged: false,
  requiredRewritePages: ["/openwiki/architecture/router.md"],
  initialPages: ["/openwiki/quickstart.md", "/openwiki/architecture/router.md"],
  sourceFingerprint: "sha256:" + "a".repeat(64),
  targetGitHead: "0123456789abcdef0123456789abcdef01234567",
  actor: { producerActor: "openwiki", metadataModel: "anthropic:claude-sonnet-5" },
  previousLastUpdate: { updatedAt: "2025-12-31T00:00:00.000Z", command: "init", model: "anthropic:claude-sonnet-5", gitHead: "fedcba9876543210fedcba9876543210fedcba98", status: "complete", language: "en" },
  baseGitHead: "fedcba9876543210fedcba9876543210fedcba98",
  beforeContentSnapshot: "sha256:" + "b".repeat(64),
  preparedWiki: { pages: [{ page: "/openwiki/quickstart.md", bodyHash: "sha256:" + "c".repeat(64), generated: { by: "openwiki", at: "2025-12-31T00:00:00.000Z" } }] },
  plan: {
    pages: [
      { id: "1e7b6d9c-1111-4aaa-8bbb-000000000001", path: "/openwiki/architecture/router.md", title: "Class-based router", purpose: "Explain routing", seedPaths: ["src/router.ts"], relatedPages: ["/openwiki/quickstart.md"], instructions: ["Cover signals"], status: "complete", completedBy: "openwiki" },
      { id: "1e7b6d9c-1111-4aaa-8bbb-000000000002", path: "/openwiki/architecture/translate.md", title: "OpenAI to Converse", purpose: "Explain translation", seedPaths: ["src/translate.ts"], relatedPages: [], instructions: [], status: "pending" },
      { id: "1e7b6d9c-1111-4aaa-8bbb-000000000003", path: "/openwiki/quickstart.md", title: "Quickstart", purpose: "Routing map", seedPaths: [], relatedPages: [], instructions: [], status: "pending" },
    ],
    deletePages: [],
  },
};

describe("readRunProgress against an openwiki 0.5.1-shaped checkpoint", () => {
  it("reads mode, phase, counts and the current page", () => {
    const dir = repoWithCheckpoint(REAL_0_5_1_STATE, 30_000);
    const progress = readRunProgress(dir, NOW)!;
    expect(progress).toMatchObject({ runId: REAL_0_5_1_STATE.runId, mode: "update", phase: "generating", total: 3, done: 1, current: "OpenAI to Converse", live: true });
    expect(formatRunStatusLine(progress)).toBe("openwiki: update · page 2/3 · 6m00s");
  });
});
