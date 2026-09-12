import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { computeDrift, formatUpdateSuggestion } from "../src/freshness.js";
import { countClaims, readLastUpdate, readPageManifest } from "../src/metadata.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

/** A repo with one commit, a wiki generated at that commit (0.5-style metadata), then more commits. */
function repo(): { dir: string; wikiHead: string } {
  const dir = mkdtempSync(join(tmpdir(), "ow-fresh-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  git(dir, "add", "."); git(dir, "commit", "-qm", "one");
  const wikiHead = git(dir, "rev-parse", "HEAD");
  mkdirSync(join(dir, "openwiki", ".claims", "core"), { recursive: true });
  writeFileSync(join(dir, "openwiki", "index.md"), "# Index\n");
  writeFileSync(join(dir, "openwiki", ".last-update.json"), JSON.stringify({ updatedAt: "2026-09-10T00:00:00.000Z", command: "init", model: "anthropic:claude-sonnet-5", gitHead: wikiHead, status: "complete", language: "en" }));
  writeFileSync(join(dir, "openwiki", ".page-manifest.json"), JSON.stringify({ schemaVersion: 1, pages: { "/openwiki/quickstart.md": { gitHead: wikiHead, completedBy: "openwiki" }, "/openwiki/core/a.md": { gitHead: "0000000000000000000000000000000000000000", completedBy: "openwiki" } } }));
  writeFileSync(join(dir, "openwiki", ".claims", "core", "a.json"), "{}");
  git(dir, "add", "."); git(dir, "commit", "-qm", "wiki");
  return { dir, wikiHead };
}

describe("metadata readers", () => {
  it("read OpenWiki 0.5 bookkeeping files and tolerate their absence", () => {
    const { dir, wikiHead } = repo();
    expect(readLastUpdate(dir)).toMatchObject({ command: "init", gitHead: wikiHead, status: "complete", model: "anthropic:claude-sonnet-5" });
    expect(Object.keys(readPageManifest(dir)!.pages)).toHaveLength(2);
    expect(countClaims(dir)).toBe(1);
    const empty = mkdtempSync(join(tmpdir(), "ow-empty-"));
    expect(readLastUpdate(empty)).toBeUndefined();
    expect(readPageManifest(empty)).toBeUndefined();
    expect(countClaims(empty)).toBeUndefined();
  });
});

describe("computeDrift with a last-update baseline", () => {
  it("is quiet when only the wiki commit happened after the run", () => {
    const { dir } = repo();
    const drift = computeDrift(dir, DEFAULT_CONFIG);
    expect(drift.baseline).toBe("last-update");
    // the commit that added openwiki/ counts, but no source file changed
    expect(drift.commitsSince).toBe(1);
    expect(drift.changedFiles).toEqual([]);
    expect(drift.pagesBehind).toEqual(["/openwiki/core/a.md"]);
  });

  it("counts commits and files since the recorded head, excluding wiki paths, and flags interrupted runs", () => {
    const { dir } = repo();
    writeFileSync(join(dir, "package.json"), "{}\n");
    writeFileSync(join(dir, "b.ts"), "export const b = 2;\n");
    git(dir, "add", "."); git(dir, "commit", "-qm", "two");
    writeFileSync(join(dir, "a.ts"), "export const a = 3;\n"); // uncommitted
    const drift = computeDrift(dir, DEFAULT_CONFIG);
    expect(drift.commitsSince).toBe(2);
    expect(drift.changedFiles.sort()).toEqual(["a.ts", "b.ts", "package.json"]);
    expect(drift.uncommittedFileCount).toBe(1);
    expect(drift.importantChangedFiles).toEqual(["package.json"]);
    expect(drift.staleBecause.join("\n")).toMatch(/2 commits since the last OpenWiki init \(2 files changed\)/);
    expect(drift.staleBecause.join("\n")).toMatch(/Important files changed: package.json/);

    writeFileSync(join(dir, "openwiki", ".last-update.json"), JSON.stringify({ updatedAt: "x", command: "update", model: "m", gitHead: drift.lastUpdate!.gitHead, status: "interrupted" }));
    expect(computeDrift(dir, DEFAULT_CONFIG).staleBecause.join("\n")).toMatch(/interrupted; rerunning resumes/);
    const text = formatUpdateSuggestion(computeDrift(dir, DEFAULT_CONFIG), DEFAULT_CONFIG);
    expect(text).toMatch(/Last run: update .*\(INTERRUPTED\)/);
    expect(text).toMatch(/Commits since last run: 2/);
    expect(text).toMatch(/Pages: 2, 1 verified against an older head/);
  });

  it("falls back to the mtime heuristic for pre-0.5 wikis and reports a missing index", () => {
    const { dir } = repo();
    execFileSync("rm", [join(dir, "openwiki", ".last-update.json")]);
    const drift = computeDrift(dir, DEFAULT_CONFIG);
    expect(drift.baseline).toBe("mtime");
    expect(drift.commitsSince).toBeUndefined();
    const bare = mkdtempSync(join(tmpdir(), "ow-bare-"));
    git(bare, "init", "-q");
    expect(computeDrift(bare, DEFAULT_CONFIG)).toMatchObject({ indexExists: false, baseline: "none" });
    expect(computeDrift(bare, DEFAULT_CONFIG).staleBecause[0]).toMatch(/No local OpenWiki index/);
  });
});
