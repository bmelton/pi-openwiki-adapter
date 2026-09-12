import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { describeEvidenceBlockers, scanClaimsEvidence } from "../src/claims.js";

describe("claims evidence scan", () => {
  it("finds symlinked and missing evidence across sidecars and explains the blocker", () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-claims-"));
    mkdirSync(join(dir, "openwiki", ".claims", "architecture"), { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "# real\n");
    symlinkSync("CLAUDE.md", join(dir, "AGENTS.md"));
    writeFileSync(join(dir, "src.ts"), "x\n");
    const sidecar = (claims: unknown) => JSON.stringify({ claims });
    writeFileSync(join(dir, "openwiki", ".claims", "quickstart.json"), sidecar([{ id: "1", statement: "s", evidence: [{ resource: "repo://AGENTS.md#L1-L3", version: "v" }, { resource: "repo://src.ts", version: "v" }] }]));
    writeFileSync(join(dir, "openwiki", ".claims", "architecture", "router.json"), sidecar([{ id: "2", statement: "s", evidence: [{ resource: "repo://AGENTS.md", version: "v" }, { resource: "repo://gone.ts#L1", version: "v" }, { resource: "web://ignored", version: "v" }] }]));
    writeFileSync(join(dir, "openwiki", ".claims", "broken.json"), "{not json");

    const scan = scanClaimsEvidence(dir)!;
    expect(scan).toMatchObject({ files: 3, claims: 2, resources: ["AGENTS.md", "gone.ts", "src.ts"] });
    expect(scan.symlinks).toEqual([{ path: "AGENTS.md", target: "CLAUDE.md", pages: ["architecture/router.md", "quickstart.md"] }]);
    expect(scan.missing).toEqual([{ path: "gone.ts", pages: ["architecture/router.md"] }]);
    const text = describeEvidenceBlockers(scan)!;
    expect(text).toMatch(/OpenWiki will refuse this run: 1 file is cited/);
    expect(text).toMatch(/- AGENTS\.md -> CLAUDE\.md  \(cited by architecture\/router\.md, quickstart\.md\)/);
    expect(text).toMatch(/@AGENTS\.md/);
  });

  it("is undefined without a .claims directory and quiet when nothing is symlinked", () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-claims-"));
    expect(scanClaimsEvidence(dir)).toBeUndefined();
    mkdirSync(join(dir, "openwiki", ".claims"), { recursive: true });
    writeFileSync(join(dir, "a.ts"), "x\n");
    writeFileSync(join(dir, "openwiki", ".claims", "p.json"), JSON.stringify({ claims: [{ id: "1", statement: "s", evidence: [{ resource: "repo://a.ts", version: "v" }] }] }));
    const scan = scanClaimsEvidence(dir)!;
    expect(scan.symlinks).toEqual([]);
    expect(describeEvidenceBlockers(scan)).toBeUndefined();
  });
});
