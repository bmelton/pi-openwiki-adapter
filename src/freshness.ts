import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { DriftSummary, ResolvedOpenWikiConfig } from "./types.js";

const IMPORTANT_PATTERNS = [
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)(schema|schemas|migrations?)\//,
  /(^|\/)(routes?|pages|app)\//,
  /(^|\/)(vite|webpack|rollup|tsup|next|nuxt|svelte|astro)\.config\./,
  /(^|\/)tsconfig\.json$/,
  /(^|\/).+\.(d\.ts|proto|graphql|gql)$/,
  /(^|\/)(Dockerfile|compose\.ya?ml|docker-compose\.ya?ml)$/,
];

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

export function detectIndexPath(cwd: string): string | undefined {
  const candidates = [
    join(cwd, ".openwiki"),
    join(cwd, "openwiki"),
    join(cwd, "docs", "openwiki"),
    join(cwd, ".wiki"),
  ];
  return candidates.find(existsSync);
}

export function computeDrift(cwd: string, config: ResolvedOpenWikiConfig): DriftSummary {
  const indexPath = detectIndexPath(cwd);
  const changed = git(cwd, ["status", "--porcelain", "--untracked-files=no"])
    ?.split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean) ?? [];
  const latestCommit = git(cwd, ["rev-parse", "HEAD"]);
  const latestCommitUnix = git(cwd, ["log", "-1", "--format=%ct"]);
  const latestCommitTime = latestCommitUnix ? new Date(Number(latestCommitUnix) * 1000).toISOString() : undefined;
  const indexMtime = indexPath ? statSync(indexPath).mtime.toISOString() : undefined;
  const staleBecause: string[] = [];

  if (!indexPath) staleBecause.push("No local OpenWiki index was found in common locations.");
  if (indexMtime && latestCommitUnix && statSync(indexPath!).mtimeMs < Number(latestCommitUnix) * 1000) {
    staleBecause.push("The detected OpenWiki index is older than the latest git commit.");
  }

  const importantChangedFiles = changed.filter((file) => IMPORTANT_PATTERNS.some((pattern) => pattern.test(file)));
  if (changed.length >= config.freshness.significantFileThreshold) {
    staleBecause.push(`${changed.length} files have uncommitted changes, meeting the configured significant drift threshold.`);
  }
  if (importantChangedFiles.length > 0) {
    staleBecause.push(`Important files changed: ${importantChangedFiles.slice(0, 8).join(", ")}${importantChangedFiles.length > 8 ? " …" : ""}`);
  }

  return {
    indexExists: Boolean(indexPath),
    indexPath,
    changedFiles: changed,
    changedFileCount: changed.length,
    importantChangedFiles,
    latestCommit,
    latestCommitTime,
    indexMtime,
    staleBecause,
    significant: staleBecause.length > 0 && (!indexPath || changed.length >= config.freshness.significantFileThreshold || importantChangedFiles.length > 0 || Boolean(indexMtime && latestCommitUnix)),
  };
}

export function shouldNudge(drift: DriftSummary, config: ResolvedOpenWikiConfig): boolean {
  switch (config.freshness.nudge) {
    case "off": return false;
    case "missing-only": return !drift.indexExists;
    case "any-drift": return !drift.indexExists || drift.staleBecause.length > 0 || drift.changedFileCount > 0;
    case "significant-drift": return !drift.indexExists || drift.significant;
  }
}

export function formatUpdateSuggestion(drift: DriftSummary, config: ResolvedOpenWikiConfig): string {
  const lines = [
    `OpenWiki freshness policy: managedBy=${config.freshness.managedBy}, nudge=${config.freshness.nudge}, autoUpdate=false`,
    `Index: ${drift.indexExists ? `found at ${drift.indexPath}` : "missing"}`,
  ];
  if (drift.indexMtime) lines.push(`Index modified: ${drift.indexMtime}`);
  if (drift.latestCommitTime) lines.push(`Latest git commit: ${drift.latestCommitTime}`);
  lines.push(`Changed files: ${drift.changedFileCount}`);
  if (drift.staleBecause.length) {
    lines.push("Update may be useful because:", ...drift.staleBecause.map((x) => `- ${x}`));
  } else {
    lines.push("No significant local git drift detected.");
  }
  lines.push("No update was run. Use /openwiki update to explicitly run `openwiki --update --print`.");
  return lines.join("\n");
}
