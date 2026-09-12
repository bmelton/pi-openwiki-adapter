// Translate the model a Pi session is on into the environment OpenWiki's own agent reads, so `/openwiki update` writes
// the wiki with the same provider/model Pi is using. Pure: the caller supplies the resolved credential.
//
// OpenWiki providers (dist/config/constants.js) are selected by OPENWIKI_PROVIDER and each reads its own key/base-URL
// variables; process env wins over ~/.openwiki/.env. Mapping is by API dialect, not provider name, so custom providers
// (bedrouter, corporate gateways) work the same as the built-in ones.

export type SessionModel = { provider: string; id: string; api: string; baseUrl: string };
export type SessionAuth = { ok: true; apiKey?: string; headers?: Record<string, string | null | undefined>; baseUrl?: string } | { ok: false; error: string };

export type SessionRoute =
  | { ok: true; env: Record<string, string>; openwikiProvider: string; label: string }
  | { ok: false; reason: string };

const host = (u: string) => { try { return new URL(u).host; } catch { return ""; } };
const strip = (u: string) => u.replace(/\/+$/u, "");

/**
 * @param model  Pi's active model.
 * @param auth   What Pi would send for it (registry.getApiKeyAndHeaders).
 * @param oauth  Whether that credential is an OAuth session token (registry.isUsingOAuth). Those are bound to the host
 *               application and its headers; OpenWiki cannot present them, and subscription terms do not allow it.
 */
export function sessionRoute(model: SessionModel, auth: SessionAuth, oauth: boolean): SessionRoute {
  const label = `${model.provider}/${model.id}`;
  if (oauth) return { ok: false, reason: `${label} is signed in with OAuth (a subscription login), which OpenWiki cannot reuse` };
  if (!auth.ok) return { ok: false, reason: `${label}: ${auth.error}` };
  const key = auth.apiKey ?? "";
  const baseUrl = strip(auth.baseUrl || model.baseUrl || "");
  if (!key) return { ok: false, reason: `${label} has no API key Pi can hand over` };
  if (!/^[\w.:/@+,-]+$/u.test(model.id)) return { ok: false, reason: `${label}: model id is not something OpenWiki accepts` };

  switch (model.api) {
    case "anthropic-messages":
      return { ok: true, openwikiProvider: "anthropic", label, env: { OPENWIKI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: baseUrl || "https://api.anthropic.com", OPENWIKI_MODEL_ID: model.id } };
    case "openai-completions":
    case "openai-responses": {
      const h = host(baseUrl);
      if (model.provider === "openrouter" || h === "openrouter.ai") return { ok: true, openwikiProvider: "openrouter", label, env: { OPENWIKI_PROVIDER: "openrouter", OPENROUTER_API_KEY: key, OPENWIKI_MODEL_ID: model.id } };
      if (model.provider === "openai" || h === "api.openai.com") return { ok: true, openwikiProvider: "openai", label, env: { OPENWIKI_PROVIDER: "openai", OPENAI_API_KEY: key, ...(baseUrl && h !== "api.openai.com" ? { OPENAI_BASE_URL: baseUrl } : {}), OPENWIKI_MODEL_ID: model.id } };
      // any other OpenAI-shaped endpoint (bedrouter's gpt-oss ladder, a corporate gateway, a local server)
      return { ok: true, openwikiProvider: "openai-compatible", label, env: { OPENWIKI_PROVIDER: "openai-compatible", OPENAI_COMPATIBLE_API_KEY: key, OPENAI_COMPATIBLE_BASE_URL: baseUrl, OPENAI_COMPATIBLE_USE_RESPONSES_API: model.api === "openai-responses" ? "1" : "0", OPENWIKI_MODEL_ID: model.id } };
    }
    case "google-generative-ai":
      return { ok: true, openwikiProvider: "gemini", label, env: { OPENWIKI_PROVIDER: "gemini", GEMINI_API_KEY: key, OPENWIKI_MODEL_ID: model.id } };
    default:
      return { ok: false, reason: `${label} speaks ${model.api}, which OpenWiki has no provider for` };
  }
}
