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
    toolMap: {
      status: "openwiki_status",
      outline: "openwiki_outline",
      search: "openwiki_search",
      read: "openwiki_read",
      update: "openwiki_update",
    },
  },
  tools: {
    autoEnableForCodeLookup: true,
    explicitEnabled: false,
    explicitDisabled: false,
  },
  freshness: {
    managedBy: "unknown",
    nudge: "significant-drift",
    autoUpdate: false,
    lastPromptedAt: "",
    lastDismissedAt: "",
    significantFileThreshold: 10,
  },
  tokenBudget: {
    outlineChars: 8_000,
    searchResultChars: 8_000,
    pageChars: 12_000,
    maxResults: 8,
  },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (existing && typeof existing === "object" && !Array.isArray(existing) && value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

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

export function resolveConfig(cwd: string): { config: ResolvedOpenWikiConfig; paths: { project: string; global: string } } {
  const globalPath = globalConfigPath();
  const projectPath = projectConfigPath(cwd);
  let config = DEFAULT_CONFIG;
  config = deepMerge(config, readJson(globalPath));
  config = deepMerge(config, readJson(projectPath));
  config.openwiki.cwd = resolve(cwd, config.openwiki.cwd || ".");
  return { config, paths: { project: projectPath, global: globalPath } };
}

export function truncateText(text: string, budget: number): { text: string; truncated: boolean } {
  if (budget <= 0 || text.length <= budget) return { text, truncated: false };
  const suffix = `\n\n[openwiki output truncated to ${budget} characters]`;
  return { text: text.slice(0, Math.max(0, budget - suffix.length)) + suffix, truncated: true };
}
