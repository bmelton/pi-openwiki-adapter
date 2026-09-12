import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { OpenWikiConfig, ResolvedOpenWikiConfig } from "./types.js";

export const DEFAULT_CONFIG: ResolvedOpenWikiConfig = {
  enabled: true,
  openwiki: {
    command: "openwiki",
    args: [],
    cwd: ".",
    timeoutMs: 30 * 60_000,
  },
  routing: {
    mode: "bedrouter",
    port: 20129,
    model: "auto",
  },
  tools: {
    autoEnableForCodeLookup: true,
  },
  freshness: {
    managedBy: "unknown",
    nudge: true,
    significantFileThreshold: 10,
  },
  tokenBudget: {
    outlineChars: 8_000,
    searchResultChars: 8_000,
    pageChars: 12_000,
    maxResults: 8,
  },
};

function readJson(path: string): OpenWikiConfig | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as OpenWikiConfig;
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "openwiki.json");
}

export function globalConfigPath(): string {
  return join(homedir(), CONFIG_DIR_NAME, "agent", "openwiki.json");
}

/** The generated OpenWiki Markdown directory. Single source of truth for readers and drift checks. */
export function wikiDir(cwd: string): string {
  return join(cwd, "openwiki");
}

export function resolveConfig(cwd: string): { config: ResolvedOpenWikiConfig; paths: { project: string; global: string } } {
  const globalPath = globalConfigPath();
  const projectPath = projectConfigPath(cwd);
  const merged = [readJson(globalPath), readJson(projectPath)].reduce<ResolvedOpenWikiConfig>((acc, override) => override ? {
    ...acc,
    ...override,
    openwiki: { ...acc.openwiki, ...override.openwiki },
    routing: { ...acc.routing, ...override.routing },
    tools: { ...acc.tools, ...override.tools },
    freshness: { ...acc.freshness, ...override.freshness },
    tokenBudget: { ...acc.tokenBudget, ...override.tokenBudget },
  } : acc, DEFAULT_CONFIG);
  const config = { ...merged, openwiki: { ...merged.openwiki, cwd: resolve(cwd, merged.openwiki.cwd || ".") } };
  return { config, paths: { project: projectPath, global: globalPath } };
}

export function truncateText(text: string, budget: number): { text: string; truncated: boolean } {
  if (budget <= 0 || text.length <= budget) return { text, truncated: false };
  const suffix = `\n\n[openwiki output truncated to ${budget} characters]`;
  return { text: text.slice(0, Math.max(0, budget - suffix.length)) + suffix, truncated: true };
}
