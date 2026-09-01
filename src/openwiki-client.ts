import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import type { ResolvedOpenWikiConfig } from "./types.js";

export type OpenWikiResult = { text: string; raw?: unknown };

export class OpenWikiClient {
  constructor(private readonly config: ResolvedOpenWikiConfig) {}

  async detectOpenWiki(signal?: AbortSignal): Promise<{ available: boolean; version?: string; error?: string }> {
    const baseArgs = this.config.openwiki.args ?? [];
    try {
      const out = await exec(this.config.openwiki.command, [...baseArgs, "--help"], { cwd: this.config.openwiki.cwd, signal, timeout: 10_000 });
      return { available: true, version: parseVersion(out) };
    } catch (helpError) {
      try {
        // Older/future OpenWiki builds may not support --help consistently, but a
        // printable one-shot prompt is enough to prove the CLI is installed.
        const out = await exec(this.config.openwiki.command, [...baseArgs, "--print", "ping"], { cwd: this.config.openwiki.cwd, signal, timeout: 10_000 });
        return { available: true, version: parseVersion(out) };
      } catch (probeError) {
        const error = probeError instanceof Error ? probeError.message : String(probeError);
        const helpMessage = helpError instanceof Error ? helpError.message : String(helpError);
        return { available: false, error: error || helpMessage };
      }
    }
  }

  async getStatus(signal?: AbortSignal): Promise<OpenWikiResult> {
    const detected = await this.detectOpenWiki(signal);
    const wikiDir = this.wikiDir();
    return {
      text: [
        `OpenWiki CLI: ${detected.available ? "available" : "unavailable"}${detected.version ? ` (${detected.version})` : ""}`,
        detected.error ? `Error: ${detected.error}` : undefined,
        `Wiki directory: ${existsSync(wikiDir) ? wikiDir : "missing"}`,
      ].filter(Boolean).join("\n"),
      raw: { detected, wikiDir },
    };
  }

  async getOutline(input: { focus?: string; budget?: number }, _signal?: AbortSignal): Promise<OpenWikiResult> {
    const files = this.markdownFiles(input.focus);
    const lines: string[] = [];
    for (const file of files) {
      const rel = relative(this.wikiDir(), file);
      lines.push(`- ${rel}`);
      for (const heading of extractHeadings(readFileSync(file, "utf8"))) {
        lines.push(`  ${"  ".repeat(Math.max(0, heading.level - 1))}- ${heading.text} (${rel}#${slugify(heading.text)})`);
      }
    }
    return { text: lines.join("\n") || "No OpenWiki markdown files found.", raw: { files: files.map((f) => relative(this.wikiDir(), f)) } };
  }

  async search(input: { query: string; maxResults?: number; budget?: number }, _signal?: AbortSignal): Promise<OpenWikiResult> {
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = this.markdownFiles().map((file) => {
      const text = readFileSync(file, "utf8");
      const lower = text.toLowerCase();
      const score = terms.reduce((sum, term) => sum + count(lower, term), 0);
      const idx = terms.length ? Math.min(...terms.map((term) => lower.indexOf(term)).filter((x) => x >= 0)) : -1;
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 180), idx + 420).replace(/\s+/g, " ").trim() : extractHeadings(text).slice(0, 3).map((h) => h.text).join("; ");
      return { file, score, snippet };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, input.maxResults ?? this.config.tokenBudget.maxResults);
    const wiki = this.wikiDir();
    return {
      text: results.map((r, i) => `${i + 1}. ${relative(wiki, r.file)} (score ${r.score})\n   id: ${relative(wiki, r.file)}\n   ${r.snippet}`).join("\n\n") || "No OpenWiki results found.",
      raw: { results: results.map((r) => ({ ...r, file: relative(wiki, r.file) })) },
    };
  }

  async readPageOrSection(input: { id: string; budget?: number }, _signal?: AbortSignal): Promise<OpenWikiResult> {
    const [pathPart, slug] = input.id.split("#", 2);
    const file = resolve(this.wikiDir(), pathPart);
    if (!file.startsWith(this.wikiDir()) || !existsSync(file)) throw new Error(`OpenWiki page not found: ${input.id}`);
    let text = readFileSync(file, "utf8");
    if (slug) text = sectionBySlug(text, slug) ?? text;
    return { text: `Source: ${relative(this.wikiDir(), file)}${slug ? `#${slug}` : ""}\n\n${text}`, raw: { file: relative(this.wikiDir(), file), slug } };
  }

  async runUpdate(_input: { force?: boolean } = {}, signal?: AbortSignal): Promise<OpenWikiResult> {
    const text = await runStreaming(this.config.openwiki.command, [...this.config.openwiki.args, "--update", "--print"], { cwd: this.config.openwiki.cwd, signal, timeout: this.config.openwiki.timeoutMs });
    return { text: text || "OpenWiki update completed." };
  }

  async runInit(_input: { force?: boolean } = {}, signal?: AbortSignal): Promise<OpenWikiResult> {
    const text = await runStreaming(this.config.openwiki.command, [...this.config.openwiki.args, "--init", "--print"], { cwd: this.config.openwiki.cwd, signal, timeout: this.config.openwiki.timeoutMs });
    return { text: text || "OpenWiki initialization completed." };
  }

  private wikiDir(): string {
    return join(this.config.openwiki.cwd, "openwiki");
  }

  private markdownFiles(focus?: string): string[] {
    const root = this.wikiDir();
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

export function mcpResultToText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return raw == null ? "" : String(raw);
  const content = (raw as { content?: unknown }).content;
  if (Array.isArray(content)) return content.map((item) => item && typeof item === "object" && "text" in item ? String((item as { text: unknown }).text) : JSON.stringify(item)).join("\n");
  return JSON.stringify(raw, null, 2);
}

function extractHeadings(text: string): Array<{ level: number; text: string }> {
  return text.split(/\r?\n/).map((line) => /^(#{1,6})\s+(.+?)\s*$/.exec(line)).filter(Boolean).map((m) => ({ level: m![1].length, text: m![2].replace(/#+$/, "").trim() }));
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[`*_~[\]()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseVersion(text: string): string | undefined {
  return /OpenWiki\s+v?([0-9]+\.[0-9]+\.[0-9][^\s]*)/i.exec(text)?.[1]
    ?? /\bv([0-9]+\.[0-9]+\.[0-9][^\s]*)\b/i.exec(text)?.[1];
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
    execFile(command, args, { cwd: opts.cwd, signal: opts.signal, timeout: opts.timeout }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message)); else resolve(String(stdout || stderr));
    });
  });
}

function runStreaming(command: string, args: string[], opts: { cwd: string; signal?: AbortSignal; timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`OpenWiki update timed out after ${opts.timeout}ms`)); }, opts.timeout);
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { out += String(d); });
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(out.trim() || `openwiki exited with ${code}`)); });
  });
}
