import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { delimiter } from "node:path";
import { wikiDir } from "./config.js";
import { metaLine, pageMeta, splitFrontMatter, type FrontMatter } from "./frontmatter.js";
import type { ResolvedOpenWikiConfig } from "./types.js";

export type OpenWikiResult = { text: string; raw?: unknown };

/** A wiki page with its OKF front matter split off. */
type Page = { file: string; rel: string; fields?: FrontMatter; body: string; meta: ReturnType<typeof pageMeta> };

// Structural files OpenWiki maintains alongside concept pages (see openwiki's okf/index-sync.js).
const QUICKSTART = "quickstart.md";
const isIndex = (rel: string) => rel === "index.md" || rel.endsWith("/index.md");
const isStructural = (rel: string) => isIndex(rel) || rel === "log.md" || rel === "INSTRUCTIONS.md";

export class OpenWikiClient {
  private readonly wiki: string;

  constructor(private readonly config: ResolvedOpenWikiConfig) {
    this.wiki = wikiDir(config.openwiki.cwd);
  }

  async detectOpenWiki(signal?: AbortSignal): Promise<{ available: boolean; version?: string; path?: string; error?: string }> {
    try {
      const out = await exec(this.config.openwiki.command, [...this.config.openwiki.args, "--help"], { cwd: this.config.openwiki.cwd, signal, timeout: 10_000 });
      // openwiki has no --version and its --help no longer prints one (0.5), so read the installed package.json.
      const located = locateBinaryPackage(this.config.openwiki.command);
      return { available: true, version: located?.version ?? parseVersion(out), path: located?.path };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** `openwiki visualize` in the background (it serves a local site and opens the browser). Returns the child pid. */
  visualize(extraArgs: string[] = []): number | undefined {
    const child = spawn(this.config.openwiki.command, [...this.config.openwiki.args, "visualize", ...extraArgs], { cwd: this.config.openwiki.cwd, detached: true, stdio: "ignore" });
    child.unref();
    return child.pid;
  }

  /**
   * Table of contents. Without a focus: the quickstart's task-routing headings, then every concept page as one line
   * (title, description) grouped by directory, using OKF front matter instead of dumping every heading of every file.
   * With a focus: only matching pages, expanded to their headings so sections can be read by id.
   */
  async getOutline(input: { focus?: string }): Promise<OpenWikiResult> {
    const pages = this.pages(input.focus);
    if (!pages.length) return { text: "No OpenWiki markdown files found.", raw: { files: [] } };
    const lines: string[] = [];
    const quick = pages.find((p) => p.rel === QUICKSTART);
    if (!input.focus && quick) {
      lines.push(`- ${QUICKSTART}  (start here: task routing)`);
      for (const h of extractHeadings(quick.body).filter((h) => h.level <= 3)) lines.push(`  ${"  ".repeat(Math.max(0, h.level - 2))}- ${h.text} (${QUICKSTART}#${slugify(h.text)})`);
    }
    const concept = pages.filter((p) => !isStructural(p.rel) && p.rel !== QUICKSTART);
    if (!input.focus) {
      let dir = "";
      for (const p of concept) {
        const d = p.rel.includes("/") ? p.rel.slice(0, p.rel.lastIndexOf("/")) : ".";
        if (d !== dir) { dir = d; lines.push(`- ${d === "." ? "(root)" : d + "/"}`); }
        const label = p.meta.title ?? extractHeadings(p.body)[0]?.text ?? p.rel;
        lines.push(`  - ${label} (${p.rel})${p.meta.description ? ` — ${p.meta.description}` : ""}${p.meta.status && p.meta.status !== "stable" ? ` [${p.meta.status}]` : ""}`);
      }
    } else {
      for (const p of pages.filter((p) => !isStructural(p.rel))) {
        lines.push(`- ${p.meta.title ?? p.rel} (${p.rel})${p.meta.description ? ` — ${p.meta.description}` : ""}`);
        for (const h of extractHeadings(p.body)) lines.push(`  ${"  ".repeat(Math.max(0, h.level - 1))}- ${h.text} (${p.rel}#${slugify(h.text)})`);
      }
    }
    const brief = pages.find((p) => p.rel === "INSTRUCTIONS.md");
    if (!input.focus && brief) lines.push(`- INSTRUCTIONS.md  (user-authored brief for the wiki generator)`);
    return { text: lines.join("\n"), raw: { files: pages.map((p) => p.rel), pages: concept.length } };
  }

  /** Ranked search: front-matter title and description outweigh body mentions; index/log pages are skipped. */
  async search(input: { query: string; maxResults?: number }): Promise<OpenWikiResult> {
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = this.pages().filter((p) => !isStructural(p.rel)).map((p) => {
      const title = (p.meta.title ?? "").toLowerCase(), desc = (p.meta.description ?? "").toLowerCase(), tags = p.meta.tags.join(" ").toLowerCase(), body = p.body.toLowerCase(), path = p.rel.toLowerCase();
      let score = 0;
      for (const t of terms) score += 10 * count(title, t) + 5 * count(desc, t) + 4 * count(tags, t) + 3 * count(path, t) + count(body, t);
      const idx = terms.length ? Math.min(...terms.map((t) => body.indexOf(t)).filter((x) => x >= 0)) : -1;
      const snippet = p.meta.description ?? (idx >= 0 ? p.body.slice(Math.max(0, idx - 120), idx + 300).replace(/\s+/g, " ").trim() : extractHeadings(p.body).slice(0, 3).map((h) => h.text).join("; "));
      // the best-matching section, so the caller can read just that part
      const section = extractHeadings(p.body).find((h) => terms.some((t) => h.text.toLowerCase().includes(t)));
      return { rel: p.rel, title: p.meta.title, score, snippet, section: section ? `${p.rel}#${slugify(section.text)}` : undefined };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, input.maxResults ?? this.config.tokenBudget.maxResults);
    return {
      text: results.map((r, i) => `${i + 1}. ${r.title ? `${r.title} — ` : ""}${r.rel} (score ${r.score})\n   id: ${r.rel}${r.section ? `\n   section: ${r.section}` : ""}\n   ${r.snippet}`).join("\n\n") || "No OpenWiki results found.",
      raw: { results },
    };
  }

  /** Read a page or `page#section`. OKF front matter is folded into one metadata line instead of raw YAML. */
  async readPageOrSection(input: { id: string }): Promise<OpenWikiResult> {
    const [pathPart, slug] = input.id.replace(/^\/?openwiki\//, "").split("#", 2);
    const file = resolve(this.wiki, pathPart);
    if (!file.startsWith(this.wiki) || !existsSync(file)) throw new Error(`OpenWiki page not found: ${input.id}`);
    const { fields, body } = splitFrontMatter(readFileSync(file, "utf8"));
    let text = body;
    if (slug) text = sectionBySlug(body, slug) ?? body;
    const head = [`Source: ${relative(this.wiki, file)}${slug ? `#${slug}` : ""}`, metaLine(fields)].filter(Boolean).join("\n");
    return { text: `${head}\n\n${text.trim()}`, raw: { file: relative(this.wiki, file), slug, meta: pageMeta(fields) } };
  }

  async runUpdate(signal?: AbortSignal): Promise<OpenWikiResult> {
    return { text: await this.run("--update", signal) || "OpenWiki update completed." };
  }

  async runInit(signal?: AbortSignal): Promise<OpenWikiResult> {
    return { text: await this.run("--init", signal) || "OpenWiki initialization completed." };
  }

  private run(flag: string, signal?: AbortSignal): Promise<string> {
    return exec(this.config.openwiki.command, [...this.config.openwiki.args, flag, "--print"], { cwd: this.config.openwiki.cwd, signal, timeout: this.config.openwiki.timeoutMs });
  }

  private pages(focus?: string): Page[] {
    const pages = this.markdownFiles().map((file) => {
      const { fields, body } = splitFrontMatter(readFileSync(file, "utf8"));
      return { file, rel: relative(this.wiki, file), fields, body, meta: pageMeta(fields) };
    });
    if (!focus) return pages;
    const q = focus.toLowerCase();
    return pages.filter((p) => p.rel.toLowerCase().includes(q) || (p.meta.title ?? "").toLowerCase().includes(q) || (p.meta.description ?? "").toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
  }

  private markdownFiles(focus?: string): string[] {
    const root = this.wiki;
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".")) continue;
        const path = join(dir, name);
        const st = statSync(path);
        if (st.isDirectory()) visit(path);
        else if (/\.mdx?$/i.test(name)) files.push(path);
      }
    };
    visit(root);
    if (!focus) return files.sort();
    const q = focus.toLowerCase();
    return files.filter((f) => relative(root, f).toLowerCase().includes(q) || readFileSync(f, "utf8").toLowerCase().includes(q)).sort();
  }
}

function extractHeadings(text: string): Array<{ level: number; text: string }> {
  return text.split(/\r?\n/).map((line) => /^(#{1,6})\s+(.+?)\s*$/.exec(line)).filter(Boolean).map((m) => ({ level: m![1].length, text: m![2].replace(/#+$/, "").trim() }));
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[`*_~[\]()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Resolve a command through PATH and symlinks to the npm package that owns it, and read its version. */
export function locateBinaryPackage(command: string, env: NodeJS.ProcessEnv = process.env): { path: string; version: string } | undefined {
  const candidates = isAbsolute(command) || command.includes("/") ? [command] : (env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, command));
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    let real: string;
    try { real = realpathSync(c); } catch { continue; }
    // walk up from the real script location looking for the owning package.json
    for (let dir = dirname(real); dir !== dirname(dir); dir = dirname(dir)) {
      const pkg = join(dir, "package.json");
      if (!existsSync(pkg)) continue;
      try {
        const json = JSON.parse(readFileSync(pkg, "utf8"));
        if (typeof json.version === "string") return { path: dir, version: json.version };
      } catch { /* keep walking */ }
    }
  }
  return undefined;
}

function parseVersion(text: string): string | undefined {
  return /(?:OpenWiki\s+|\bv)v?([0-9]+\.[0-9]+\.[0-9][^\s]*)/i.exec(text)?.[1];
}

function sectionBySlug(text: string, slug: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return m && slugify(m[2]) === slug;
  });
  if (start < 0) return undefined;
  const level = /^(#{1,6})/.exec(lines[start])![1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

function count(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function exec(command: string, args: string[], opts: { cwd: string; signal?: AbortSignal; timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    // ponytail: buffered, not streamed. `openwiki --print` collects its whole report in memory and
    // writes it on exit, so streaming stdout yields nothing. Live progress comes from the
    // openwiki/.run.json checkpoint instead (see run-progress.ts).
    execFile(command, args, { cwd: opts.cwd, signal: opts.signal, timeout: opts.timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim())); else resolve(String(stdout || stderr).trim());
    });
  });
}
