import { describe, expect, it } from "vitest";
import { truncateText } from "../src/config.js";

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
