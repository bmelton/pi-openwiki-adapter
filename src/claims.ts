// Read-only view of OpenWiki's Grounded Claims sidecars (openwiki/.claims/**/*.json, since 0.5) so the adapter can
// predict what OpenWiki's own claims preflight will do before a run is started.
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { wikiDir } from "./config.js";
import { CLAIMS_DIRNAME } from "./metadata.js";

export type EvidenceScan = {
  /** Claims sidecar files found. */
  files: number;
  claims: number;
  /** Distinct repository paths cited as evidence. */
  resources: string[];
  /** Cited paths that are symbolic links. OpenWiki refuses these outright ("Evidence cannot reference a symbolic link"). */
  symlinks: { path: string; target: string; pages: string[] }[];
  /** Cited paths that no longer exist. OpenWiki treats these as unresolved evidence and assigns the page work. */
  missing: { path: string; pages: string[] }[];
};

const REPO = /^repo:\/\/([^#]+)(?:#.*)?$/u;

export function scanClaimsEvidence(cwd: string): EvidenceScan | undefined {
  const dir = join(wikiDir(cwd), CLAIMS_DIRNAME);
  if (!existsSync(dir)) return undefined;
  const scan: EvidenceScan = { files: 0, claims: 0, resources: [], symlinks: [], missing: [] };
  const byPath = new Map<string, Set<string>>();
  const visit = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { visit(p); continue; }
      if (!name.endsWith(".json")) continue;
      scan.files++;
      let doc: { claims?: { evidence?: { resource?: string }[] }[] };
      try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      const page = relative(dir, p).replace(/\.json$/u, ".md");
      for (const claim of doc.claims ?? []) {
        scan.claims++;
        for (const ev of claim.evidence ?? []) {
          const m = typeof ev.resource === "string" ? REPO.exec(ev.resource) : null;
          if (!m) continue;
          const path = decodeURIComponent(m[1]).replace(/^\/+/u, "");
          (byPath.get(path) ?? byPath.set(path, new Set()).get(path)!).add(page);
        }
      }
    }
  };
  visit(dir);
  scan.resources = [...byPath.keys()].sort();
  for (const path of scan.resources) {
    const abs = resolve(cwd, path);
    const pages = [...byPath.get(path)!].sort();
    let st;
    try { st = lstatSync(abs); } catch { scan.missing.push({ path, pages }); continue; }
    if (st.isSymbolicLink()) {
      let target = "?";
      try { target = readlinkSync(abs); } catch { /* keep ? */ }
      scan.symlinks.push({ path, target, pages });
    }
  }
  return scan;
}

/** Human explanation of what will stop a run, or undefined when nothing will. */
export function describeEvidenceBlockers(scan: EvidenceScan | undefined): string | undefined {
  if (!scan?.symlinks.length) return undefined;
  const lines = [
    `OpenWiki will refuse this run: ${scan.symlinks.length} file${scan.symlinks.length === 1 ? " is" : "s are"} cited as Claim evidence but ${scan.symlinks.length === 1 ? "is" : "are"} a symbolic link, which OpenWiki's evidence resolver rejects ("Evidence cannot reference a symbolic link").`,
    ...scan.symlinks.map((s) => `- ${s.path} -> ${s.target}  (cited by ${s.pages.join(", ")})`),
    "Fix: make the cited path a regular file (e.g. keep AGENTS.md as the real file and have CLAUDE.md contain `@AGENTS.md`), commit, then run the update.",
  ];
  return lines.join("\n");
}
