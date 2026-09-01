import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, resolveConfig, truncateText } from "../src/config.js";

describe("truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("abc", 10)).toEqual({ text: "abc", truncated: false });
  });

  it("truncates over budget", () => {
    const result = truncateText("abcdefghijklmnopqrstuvwxyz", 12);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("truncated");
  });
});

describe("resolveConfig", () => {
  it("merges a partial section without dropping the other defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-config-"));
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "openwiki.json"), JSON.stringify({ freshness: { nudge: false } }));

    const { config } = resolveConfig(dir);

    expect(config.freshness.nudge).toBe(false);
    expect(config.freshness.significantFileThreshold).toBe(DEFAULT_CONFIG.freshness.significantFileThreshold);
  });

  it("never mutates the shared defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-config-"));

    const { config } = resolveConfig(dir);

    expect(config.openwiki.cwd).toBe(dir);
    expect(DEFAULT_CONFIG.openwiki.cwd).toBe(".");
  });
});
