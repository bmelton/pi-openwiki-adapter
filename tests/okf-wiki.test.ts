import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { OpenWikiClient } from "../src/openwiki-client.js";
import { metaLine, splitFrontMatter } from "../src/frontmatter.js";

/** A wiki shaped like openwiki 0.5 output: OKF front matter, quickstart, per-directory indexes, log. */
function wiki(): string {
  const dir = mkdtempSync(join(tmpdir(), "ow-okf-"));
  const w = join(dir, "openwiki");
  mkdirSync(join(w, "architecture"), { recursive: true });
  mkdirSync(join(w, "workflows"), { recursive: true });
  const page = (path: string, fm: string, body: string) => writeFileSync(join(w, path), `---\n${fm}\n---\n${body}`);
  page("quickstart.md", 'type: Reference\ntitle: Quickstart\ndescription: "Task-routing map for this repository."', "# Quickstart\n\n## Where to start\n\nRead the router first.\n\n## Common tasks\n\n### Add a rung\n\nEdit bedrouter.json.\n");
  page("index.md", "type: Reference\ntitle: Index", "# Index\n\n- [Quickstart](quickstart.md)\n");
  page("log.md", "type: Reference\ntitle: Log", "# Log\n\nrouter router router router\n");
  page("architecture/index.md", "type: Reference\ntitle: Architecture", "# Architecture\n");
  page("architecture/router.md", 'type: Concept\ntitle: Class-based router\ndescription: "How requests are classified and routed to a rung."\ntags:\n  - routing\n  - cost\nstatus: stable\ntimestamp: 2026-09-10T00:00:00Z\nsources:\n  - repo://src/router.ts#L1-L200', "# Class-based router\n\n## Signals\n\nThinking, shape, keywords.\n\n## Stickiness\n\nPer conversation.\n");
  page("architecture/translate.md", 'type: Concept\ntitle: OpenAI to Converse translation\ndescription: "Chat completions mapped onto the Bedrock Converse API."\nstatus: draft', "# Translation\n\nTool calls and images.\n");
  page("workflows/release.md", "type: Workflow\ntitle: Releasing\ndescription: Publish to npm.", "# Releasing\n\nRun npm publish. The router is not involved.\n");
  writeFileSync(join(w, "INSTRUCTIONS.md"), "# Brief\n\nFocus on the router.\n");
  return dir;
}

const client = (dir: string) => new OpenWikiClient({ ...DEFAULT_CONFIG, openwiki: { ...DEFAULT_CONFIG.openwiki, cwd: dir } });

describe("front matter", () => {
  it("parses scalars, block lists, inline lists and quoted strings", () => {
    const { fields, body } = splitFrontMatter('---\ntitle: "A: B"\ntags: [x, "y"]\nsources:\n  - repo://a\n  - repo://b\nstatus: draft\n---\n# Body\n');
    expect(fields).toEqual({ title: "A: B", tags: ["x", "y"], sources: ["repo://a", "repo://b"], status: "draft" });
    expect(body).toBe("# Body\n");
    expect(splitFrontMatter("# No front matter\n")).toEqual({ body: "# No front matter\n" });
    expect(metaLine(fields)).toBe("**A: B** · status: draft · tags: x, y");
  });
});

describe("OKF-aware tools", () => {
  it("outline leads with quickstart routing and lists concept pages by title/description, not every heading", async () => {
    const { text } = await client(wiki()).getOutline({});
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^- quickstart\.md/);
    expect(text).toMatch(/- Where to start \(quickstart\.md#where-to-start\)/);
    expect(text).toMatch(/- architecture\/\n  - Class-based router \(architecture\/router\.md\) — How requests are classified/);
    expect(text).toMatch(/OpenAI to Converse translation \(architecture\/translate\.md\) — .* \[draft\]/);
    expect(text).not.toMatch(/Stickiness/); // page headings are not expanded without a focus
    expect(text).not.toMatch(/log\.md/);
    expect(text).not.toMatch(/architecture\/index\.md/);
    expect(lines[lines.length - 1]).toMatch(/^- INSTRUCTIONS\.md/);
  });

  it("outline with a focus expands matching pages to their sections", async () => {
    const { text } = await client(wiki()).getOutline({ focus: "router" });
    expect(text).toMatch(/Class-based router \(architecture\/router\.md\)/);
    expect(text).toMatch(/- Stickiness \(architecture\/router\.md#stickiness\)/);
    expect(text).toMatch(/Releasing/); // its body mentions the router, so it matches; structural pages do not appear
    expect(text).not.toMatch(/log\.md|index\.md|INSTRUCTIONS/);
    expect((await client(wiki()).getOutline({ focus: "stickiness" })).text).not.toMatch(/Releasing/);
  });

  it("search ranks title/description above body mentions and skips structural pages", async () => {
    const { text, raw } = await client(wiki()).search({ query: "router" });
    const results = (raw as { results: { rel: string; section?: string }[] }).results;
    expect(results[0].rel).toBe("architecture/router.md"); // title match beats log.md's four body mentions
    expect(results.map((r) => r.rel)).not.toContain("log.md");
    expect(results.map((r) => r.rel)).toContain("workflows/release.md"); // body mention still found, ranked lower
    expect(text).toMatch(/1\. Class-based router — architecture\/router\.md/);
    expect(text).toMatch(/How requests are classified and routed to a rung\./); // description used as the snippet
  });

  it("read folds front matter into one line, strips YAML, accepts /openwiki/ prefixed ids and sections", async () => {
    const c = client(wiki());
    const page = await c.readPageOrSection({ id: "architecture/router.md" });
    expect(page.text.split("\n")[0]).toBe("Source: architecture/router.md");
    expect(page.text.split("\n")[1]).toBe("**Class-based router** · Concept · tags: routing, cost · as of 2026-09-10");
    expect(page.text.split("\n")[2]).toBe("How requests are classified and routed to a rung.");
    expect(page.text).not.toMatch(/^---/m);
    expect(page.text).not.toMatch(/sources:/);
    const section = await c.readPageOrSection({ id: "/openwiki/architecture/router.md#stickiness" });
    expect(section.text).toMatch(/## Stickiness\n\nPer conversation\./);
    expect(section.text).not.toMatch(/Signals/);
    await expect(c.readPageOrSection({ id: "../secret.md" })).rejects.toThrow(/not found/);
  });
});
