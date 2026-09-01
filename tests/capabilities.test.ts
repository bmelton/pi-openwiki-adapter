import { describe, expect, it } from "vitest";
import { hasCodebaseLookup, nextActiveTools, OPENWIKI_TOOL_NAMES } from "../src/capabilities.js";

describe("capability gating", () => {
  it("detects codebase lookup tools", () => {
    expect(hasCodebaseLookup(["read"])).toBe(true);
    expect(hasCodebaseLookup(["bash"])).toBe(false);
  });

  it("adds and removes only OpenWiki tools", () => {
    expect(nextActiveTools(["read"], true)).toEqual(["read", ...OPENWIKI_TOOL_NAMES]);
    expect(nextActiveTools(["read", "openwiki_status", "bash"], false)).toEqual(["read", "bash"]);
  });
});
