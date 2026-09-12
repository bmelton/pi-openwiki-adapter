import { describe, expect, it } from "vitest";
import { sessionRoute } from "../src/session-route.js";
import { OpenWikiClient } from "../src/openwiki-client.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const key = { ok: true as const, apiKey: "sk-test" };
const m = (provider: string, id: string, api: string, baseUrl: string) => ({ provider, id, api, baseUrl });

describe("sessionRoute", () => {
  it("maps Anthropic-dialect models (including bedrouter) to OpenWiki's anthropic provider with the same base URL", () => {
    const r = sessionRoute(m("bedrouter", "auto", "anthropic-messages", "http://127.0.0.1:20129/"), key, false);
    expect(r).toMatchObject({ ok: true, openwikiProvider: "anthropic", env: { OPENWIKI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: "http://127.0.0.1:20129", OPENWIKI_MODEL_ID: "auto" } });
    const a = sessionRoute(m("anthropic", "claude-sonnet-4-5", "anthropic-messages", "https://api.anthropic.com"), key, false);
    expect(a).toMatchObject({ ok: true, env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com" } });
  });

  it("picks openai / openrouter / openai-compatible by host and dialect", () => {
    expect(sessionRoute(m("openai", "gpt-5", "openai-responses", "https://api.openai.com/v1"), key, false))
      .toMatchObject({ ok: true, openwikiProvider: "openai", env: { OPENAI_API_KEY: "sk-test", OPENWIKI_MODEL_ID: "gpt-5" } });
    expect(sessionRoute(m("openrouter", "x/y", "openai-completions", "https://openrouter.ai/api/v1"), key, false))
      .toMatchObject({ ok: true, openwikiProvider: "openrouter", env: { OPENROUTER_API_KEY: "sk-test" } });
    expect(sessionRoute(m("bedrouter", "auto-oss", "openai-completions", "http://127.0.0.1:20129/v1"), key, false))
      .toMatchObject({ ok: true, openwikiProvider: "openai-compatible", env: { OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:20129/v1", OPENAI_COMPATIBLE_USE_RESPONSES_API: "0" } });
    expect(sessionRoute(m("google", "gemini-2.5-pro", "google-generative-ai", "https://generativelanguage.googleapis.com"), key, false))
      .toMatchObject({ ok: true, openwikiProvider: "gemini", env: { GEMINI_API_KEY: "sk-test" } });
  });

  it("refuses OAuth logins, missing keys and unknown dialects with a reason", () => {
    expect(sessionRoute(m("anthropic", "claude-opus-4-1", "anthropic-messages", ""), key, true)).toMatchObject({ ok: false, reason: expect.stringMatching(/OAuth/) });
    expect(sessionRoute(m("openai", "gpt-5", "openai-responses", ""), { ok: false, error: "No API key found" }, false)).toMatchObject({ ok: false, reason: expect.stringMatching(/No API key/) });
    expect(sessionRoute(m("openai", "gpt-5", "openai-responses", ""), { ok: true }, false)).toMatchObject({ ok: false, reason: expect.stringMatching(/no API key/) });
    expect(sessionRoute(m("aws", "x", "bedrock-converse-stream", ""), key, false)).toMatchObject({ ok: false, reason: expect.stringMatching(/no provider/) });
  });
});

describe("resolveRoute fallback chain", () => {
  const cfg = (mode: "session" | "bedrouter" | "native") => new OpenWikiClient({
    ...DEFAULT_CONFIG, openwiki: { ...DEFAULT_CONFIG.openwiki, cwd: process.cwd() }, routing: { mode, port: 1, model: "auto" },
  });
  const oauthSession = { model: m("anthropic", "claude-opus-4-1", "anthropic-messages", "https://api.anthropic.com"), oauth: true, auth: async () => key };
  const keySession = { ...oauthSession, oauth: false };

  it("uses the session model when it can, else falls through bedrouter to native and says why", async () => {
    expect(await cfg("session").resolveRoute(keySession)).toMatchObject({ via: "session", label: "anthropic/claude-opus-4-1" });
    const r = await cfg("session").resolveRoute(oauthSession);
    expect(r.via).toBe("native");
    expect(r.skipped[0]).toMatch(/OAuth/);
    expect(r.skipped[1]).toMatch(/nothing listening/);
    expect(await cfg("session").resolveRoute()).toMatchObject({ via: "native", skipped: [expect.stringMatching(/no Pi model/), expect.anything()] });
    expect(await cfg("bedrouter").resolveRoute(keySession)).toMatchObject({ via: "native", skipped: [expect.stringMatching(/nothing listening/)] });
    expect(await cfg("native").resolveRoute(keySession)).toMatchObject({ via: "native", reason: "routing.mode is native" });
  });
});
