import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { wikiDir } from "./config.js";
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

export function computeDrift(cwd: string, config: ResolvedOpenWikiConfig): DriftSummary {
  const dir = wikiDir(cwd);
  const indexPath = existsSync(dir) ? dir : undefined;
  const changed = git(cwd, ["status", "--porcelain", "--untracked-files=no"])
    ?.split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean) ?? [];
  const latestCommit = git(cwd, ["rev-parse", "HEAD"]);
  const latestCommitUnix = git(cwd, ["log", "-1", "--format=%ct"]);
  const latestCommitTime = latestCommitUnix ? new Date(Number(latestCommitUnix) * 1000).toISOString() : undefined;
  const indexMtimeMs = indexPath ? statSync(indexPath).mtimeMs : undefined;
  const staleBecause: string[] = [];

  if (!indexPath) staleBecause.push("No local OpenWiki index was found at openwiki/.");
  if (indexMtimeMs && latestCommitUnix && indexMtimeMs < Number(latestCommitUnix) * 1000) {
    staleBecause.push("The OpenWiki index is older than the latest git commit.");
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
    indexMtime: indexMtimeMs ? new Date(indexMtimeMs).toISOString() : undefined,
    staleBecause,
  };
}

export function shouldNudge(drift: DriftSummary, config: ResolvedOpenWikiConfig): boolean {
  return config.freshness.nudge && drift.staleBecause.length > 0;
}

export function formatUpdateSuggestion(drift: DriftSummary, config: ResolvedOpenWikiConfig): string {
  const lines = [
    `OpenWiki freshness policy: managedBy=${config.freshness.managedBy}, nudge=${config.freshness.nudge}`,
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
