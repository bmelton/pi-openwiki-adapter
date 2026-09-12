import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/openwiki.js";

function page(title: string, status: string) {
  return { id: title, path: `openwiki/${title}.md`, title, purpose: "p", seedPaths: [], relatedPages: [], instructions: [], status };
}

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ow-smoke-"));
  mkdirSync(join(dir, "openwiki"), { recursive: true });
  writeFileSync(join(dir, "openwiki", "index.md"), "# Index\n");
  writeFileSync(join(dir, "openwiki", ".run.json"), JSON.stringify({
    schemaVersion: 1,
    runId: "run-1",
    mode: "update",
    phase: "generating",
    startedAt: new Date(Date.now() - 252_000).toISOString(),
    plan: { pages: [page("Overview", "complete"), page("Architecture", "pending"), page("Testing", "pending")], deletePages: [] },
  }));
  return dir;
}

function harness(cwd: string) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const status: Array<[string, string | undefined]> = [];
  const notices: string[] = [];
  const confirms: boolean[] = [];
  const ui = {
    notify: (message: string) => { notices.push(message); },
    setStatus: (key: string, text: string | undefined) => { status.push([key, text]); },
    confirm: async () => { confirms.push(true); return false; },
    select: async () => undefined,
  };
  const pi = {
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: (name: string, options: any) => commands.set(name, options),
    on: (event: string, handler: any) => handlers.set(event, handler),
    getActiveTools: () => ["read", "grep", "ls", "openwiki_status", "openwiki_outline", "openwiki_search", "openwiki_read", "openwiki_update_suggestion"],
    setActiveTools: () => {},
  };
  extension(pi as any);
  const ctx = { cwd, hasUI: true, ui, signal: undefined } as any;
  return { tools, commands, handlers, ctx, status, notices, confirms };
}

describe("extension wiring", () => {
  it("reports the live run through openwiki_status", async () => {
    const dir = repo();
    const h = harness(dir);

    const result = await h.tools.get("openwiki_status").execute("id", {}, undefined, undefined, h.ctx);
    const text = result.content[0].text;

    expect(text).toContain("OpenWiki run: update in progress (live)");
    expect(text).toContain("Pages: 1/3 done, current: Architecture");
    expect((result.details as any).progress.runId).toBe("run-1");
    rmSync(dir, { recursive: true, force: true });
  });

  it("leads openwiki_update_suggestion with the live run", async () => {
    const dir = repo();
    const h = harness(dir);

    const result = await h.tools.get("openwiki_update_suggestion").execute("id", {}, undefined, undefined, h.ctx);

    expect(result.content[0].text.startsWith("OpenWiki run: update in progress")).toBe(true);
    expect(result.content[0].text).toContain("Do not start another OpenWiki run");
    rmSync(dir, { recursive: true, force: true });
  });

  it("gates /openwiki update behind the concurrency confirm", async () => {
    const dir = repo();
    const h = harness(dir);

    await h.commands.get("openwiki").handler("update", h.ctx);

    // The stub declines the override confirm, so no second confirm and no run.
    expect(h.confirms.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("drives the footer status from turn_start and clears it when the run ends", async () => {
    vi.useFakeTimers();
    const dir = repo();
    const h = harness(dir);

    await h.handlers.get("turn_start")({ type: "turn_start" }, h.ctx);
    expect(h.status.at(-1)).toEqual(["openwiki", "│ ◔ openwiki update · page 2/3 · 4m12s\u00a0\u00a0"]);

    rmSync(join(dir, "openwiki", ".run.json"));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(h.status.at(-1)).toEqual(["openwiki", undefined]);

    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });
});
