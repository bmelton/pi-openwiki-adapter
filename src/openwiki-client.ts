import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { wikiDir } from "./config.js";
import type { ResolvedOpenWikiConfig } from "./types.js";

export type OpenWikiResult = { text: string; raw?: unknown };

export class OpenWikiClient {
  private readonly wiki: string;

  constructor(private readonly config: ResolvedOpenWikiConfig) {
    this.wiki = wikiDir(config.openwiki.cwd);
  }

  async detectOpenWiki(signal?: AbortSignal): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const out = await exec(this.config.openwiki.command, [...this.config.openwiki.args, "--help"], { cwd: this.config.openwiki.cwd, signal, timeout: 10_000 });
      return { available: true, version: parseVersion(out) };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getOutline(input: { focus?: string }): Promise<OpenWikiResult> {
    const files = this.markdownFiles(input.focus);
    const lines: string[] = [];
    for (const file of files) {
      const rel = relative(this.wiki, file);
      lines.push(`- ${rel}`);
      for (const heading of extractHeadings(readFileSync(file, "utf8"))) {
        lines.push(`  ${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text} (${rel}#${slugify(heading.text)})`);
      }
    }
    return { text: lines.join("\n") || "No OpenWiki markdown files found.", raw: { files: files.map((f) => relative(this.wiki, f)) } };
  }

  async search(input: { query: string; maxResults?: number }): Promise<OpenWikiResult> {
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = this.markdownFiles().map((file) => {
      const text = readFileSync(file, "utf8");
      const lower = text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + count(lower, term), 0);
      const idx = terms.length ? Math.min(...terms.map((term) => lower.indexOf(term)).filter((x) => x >= 0)) : -1;
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 180), idx + 420).replace(/\s+/g, " ").trim() : extractHeadings(text).slice(0, 3).map((h) => h.text).join("; ");
      return { file, score, snippet };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, input.maxResults ?? this.config.tokenBudget.maxResults);
    const wiki = this.wiki;
    return {
      text: results.map((r, i) => `${i + 1}. ${relative(wiki, r.file)} (score ${r.score})\n   id: ${relative(wiki, r.file)}\n   ${r.snippet}`).join("\n\n") || "No OpenWiki results found.",
      raw: { results: results.map((r) => ({ ...r, file: relative(wiki, r.file) })) },
    };
  }

  async readPageOrSection(input: { id: string }): Promise<OpenWikiResult> {
    const [pathPart, slug] = input.id.split("#", 2);
    const file = resolve(this.wiki, pathPart);
    if (!file.startsWith(this.wiki) || !existsSync(file)) throw new Error(`OpenWiki page not found: ${input.id}`);
    let text = readFileSync(file, "utf8");
    if (slug) text = sectionBySlug(text, slug) ?? text;
    return { text: `Source: ${relative(this.wiki, file)}${slug ? `#${slug}` : ""}\n\n${text}`, raw: { file: relative(this.wiki, file), slug } };
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
