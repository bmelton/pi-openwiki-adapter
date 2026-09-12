import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterEnvFile, prepareConfigShim, ROUTE_OWNED_KEYS } from "../src/config-shim.js";

describe("config shim", () => {
  it("drops only the route-owned keys and keeps every other line verbatim", () => {
    const src = `# saved by openwiki\nOPENWIKI_PROVIDER=openai\nexport OPENWIKI_MODEL_ID = gpt-5.6-terra\nOPENWIKI_REASONING_EFFORT=high\nOPENAI_API_KEY="sk-keep me"\nANTHROPIC_API_KEY=sk-ant\n\nOPENWIKI_MAX_OUTPUT_TOKENS=4096\n`;
    const r = filterEnvFile(src, ROUTE_OWNED_KEYS);
    expect(r.dropped).toEqual(["OPENWIKI_PROVIDER", "OPENWIKI_MODEL_ID", "OPENWIKI_REASONING_EFFORT"]);
    expect(r.text).toBe(`# saved by openwiki\nOPENAI_API_KEY="sk-keep me"\nANTHROPIC_API_KEY=sk-ant\n\nOPENWIKI_MAX_OUTPUT_TOKENS=4096\n`);
  });

  it("builds a scratch config dir with a filtered .env and symlinks to everything else, and cleans up", () => {
    const real = mkdtempSync(join(tmpdir(), "ow-home-"));
    writeFileSync(join(real, ".env"), "OPENWIKI_REASONING_EFFORT=high\nOPENAI_API_KEY=sk\n");
    mkdirSync(join(real, "skills"));
    writeFileSync(join(real, "install-id"), "abc");
    const shim = prepareConfigShim(ROUTE_OWNED_KEYS, real)!;
    expect(shim.dropped).toEqual(["OPENWIKI_REASONING_EFFORT"]);
    expect(readFileSync(join(shim.dir, ".env"), "utf8")).toBe("OPENAI_API_KEY=sk\n");
    expect(lstatSync(join(shim.dir, "skills")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(shim.dir, "install-id"), "utf8")).toBe("abc");
    expect(readFileSync(join(real, ".env"), "utf8")).toBe("OPENWIKI_REASONING_EFFORT=high\nOPENAI_API_KEY=sk\n");
    shim.cleanup();
    expect(existsSync(shim.dir)).toBe(false);
  });

  it("returns nothing when the real home has no .env", () => {
    expect(prepareConfigShim(ROUTE_OWNED_KEYS, mkdtempSync(join(tmpdir(), "ow-empty-")))).toBeUndefined();
  });
});
