// A throwaway OPENWIKI_CONFIG_DIR for routed runs.
//
// OpenWiki loads ~/.openwiki/.env for every key the process environment does not already define, and there is no way to
// *unset* one of those keys from the outside: `OPENWIKI_REASONING_EFFORT=` is rejected as invalid, and any value is
// rejected unless the provider/model pair is on OpenWiki's short support table. So a reasoning effort saved for, say,
// an OpenAI model breaks every run we route elsewhere. OpenWiki does honour OPENWIKI_CONFIG_DIR, so a routed run gets a
// scratch config dir: a copy of the user's .env with the overridden keys filtered out, plus symlinks to everything else
// in the real home (skills, connectors, wiki, telemetry ids) so nothing else changes. The user's file is never modified.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Keys a route decides; whatever the user's .env says about them must not leak into a routed run. */
export const ROUTE_OWNED_KEYS = ["OPENWIKI_PROVIDER", "OPENWIKI_MODEL_ID", "OPENWIKI_REASONING_EFFORT"];

export function realConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENWIKI_CONFIG_DIR?.trim();
  if (!configured) return join(homedir(), ".openwiki");
  if (configured === "~") return homedir();
  if (configured.startsWith("~/")) return resolve(homedir(), configured.slice(2));
  return resolve(configured);
}

/** Drop `KEY=…` lines (optionally `export KEY=…`) for the given keys; every other line is kept byte-for-byte. */
export function filterEnvFile(text: string, dropKeys: string[]): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const kept = text.split(/\r?\n/).filter((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u.exec(line);
    if (m && dropKeys.includes(m[1])) { dropped.push(m[1]); return false; }
    return true;
  });
  return { text: kept.join("\n"), dropped };
}

export type ConfigShim = { dir: string; dropped: string[]; cleanup: () => void };

/**
 * Build the scratch config dir. Returns undefined when there is nothing to shim (no real .env), in which case the run
 * should proceed without OPENWIKI_CONFIG_DIR.
 */
export function prepareConfigShim(dropKeys: string[] = ROUTE_OWNED_KEYS, real: string = realConfigDir()): ConfigShim | undefined {
  const envPath = join(real, ".env");
  if (!existsSync(envPath)) return undefined;
  const { text, dropped } = filterEnvFile(readFileSync(envPath, "utf8"), dropKeys);
  const dir = mkdtempSync(join(tmpdir(), "pi-openwiki-config-"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, ".env"), text, { mode: 0o600 });
  for (const name of readdirSync(real)) {
    if (name === ".env") continue;
    try { symlinkSync(join(real, name), join(dir, name)); } catch { /* a name we cannot mirror is not worth failing the run */ }
  }
  return { dir, dropped, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } } };
}
