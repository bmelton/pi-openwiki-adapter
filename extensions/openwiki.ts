import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig, truncateText, projectConfigPath } from "../src/config.js";
import { hasCodebaseLookup, nextActiveTools, OPENWIKI_TOOL_NAMES } from "../src/capabilities.js";
import { OpenWikiClient } from "../src/openwiki-client.js";
import { computeDrift, formatUpdateSuggestion, shouldNudge } from "../src/freshness.js";

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function (pi: ExtensionAPI) {
  const requireCodeLookup = () => {
    const active = pi.getActiveTools();
    if (!hasCodebaseLookup(active)) {
      throw new Error("OpenWiki access requires codebase lookup capability (read, grep, find, or ls). This session does not have it.");
    }
  };

  const getRuntime = (cwd: string) => {
    const { config, paths } = resolveConfig(cwd);
    return { config, paths, client: new OpenWikiClient(config), drift: computeDrift(cwd, config) };
  };

  pi.registerTool({
    name: "openwiki_status",
    label: "OpenWiki Status",
    description: "Report OpenWiki CLI availability, generated wiki status, configuration, and git-based freshness state.",
    promptSnippet: "Report OpenWiki availability, index status, and freshness.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, paths, client, drift } = getRuntime(ctx.cwd);
      const detected = await client.detectOpenWiki(signal);
      return textResult([
        `OpenWiki enabled: ${config.enabled}`,
        `OpenWiki command: ${config.openwiki.command} ${config.openwiki.args.join(" ")}`.trim(),
        `OpenWiki available: ${detected.available}${detected.version ? ` (${detected.version})` : ""}`,
        detected.error ? `OpenWiki error: ${detected.error}` : undefined,
        `Project config: ${paths.project}`,
        `Global config: ${paths.global}`,
        `Index: ${drift.indexExists ? `found at ${drift.indexPath}` : "missing"}`,
        `Freshness: managedBy=${config.freshness.managedBy}, nudge=${config.freshness.nudge}, autoUpdate=false`,
        `Changed files: ${drift.changedFileCount}`,
        drift.staleBecause.length ? `Drift:\n${drift.staleBecause.map((x) => `- ${x}`).join("\n")}` : "Drift: no significant drift detected",
      ].filter(Boolean).join("\n"), { detected, drift, configPath: paths.project });
    },
  });

  pi.registerTool({
    name: "openwiki_outline",
    label: "OpenWiki Outline",
    description: "Return a compact OpenWiki table of contents for the current codebase, optionally focused by path/module/query.",
    promptSnippet: "Get a compact OpenWiki codebase table of contents.",
    promptGuidelines: ["Use openwiki_outline first for broad codebase orientation, architecture questions, locating relevant files, or planning code changes."],
    parameters: Type.Object({ focus: Type.Optional(Type.String()), budget: Type.Optional(Type.Number()) }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.outlineChars, config.tokenBudget.outlineChars);
      const result = await client.getOutline({ focus: params.focus, budget }, signal);
      const truncated = truncateText(result.text, budget);
      return textResult(truncated.text, { raw: result.raw, truncated: truncated.truncated });
    },
  });

  pi.registerTool({
    name: "openwiki_search",
    label: "OpenWiki Search",
    description: "Search OpenWiki for relevant pages, sections, files, or modules and return compact ranked results with identifiers.",
    promptSnippet: "Search OpenWiki pages/sections/files before broad file reads.",
    parameters: Type.Object({ query: Type.String(), maxResults: Type.Optional(Type.Number()), budget: Type.Optional(Type.Number()) }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.searchResultChars, config.tokenBudget.searchResultChars);
      const maxResults = Math.min(params.maxResults ?? config.tokenBudget.maxResults, config.tokenBudget.maxResults);
      const result = await client.search({ query: params.query, maxResults, budget }, signal);
      const truncated = truncateText(result.text, budget);
      return textResult(truncated.text, { raw: result.raw, truncated: truncated.truncated });
    },
  });

  pi.registerTool({
    name: "openwiki_read",
    label: "OpenWiki Read",
    description: "Read an exact OpenWiki page/section/result by identifier, preserving OpenWiki content and metadata.",
    promptSnippet: "Expand a specific OpenWiki page/section/result by id.",
    parameters: Type.Object({ id: Type.String(), budget: Type.Optional(Type.Number()) }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.pageChars, config.tokenBudget.pageChars);
      const result = await client.readPageOrSection({ id: params.id, budget }, signal);
      const truncated = truncateText(result.text, budget);
      return textResult(truncated.text, { raw: result.raw, truncated: truncated.truncated });
    },
  });

  pi.registerTool({
    name: "openwiki_update_suggestion",
    label: "OpenWiki Update Suggestion",
    description: "Explain whether refreshing OpenWiki may be useful based on configured freshness policy and git drift. Does not update.",
    promptSnippet: "Explain whether an explicit OpenWiki refresh may be useful.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, drift } = getRuntime(ctx.cwd);
      return textResult(formatUpdateSuggestion(drift, config), { drift });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const { config, client, drift } = getRuntime(ctx.cwd);
    const active = pi.getActiveTools();
    const allowed = config.enabled && !config.tools.explicitDisabled && (config.tools.explicitEnabled || (config.tools.autoEnableForCodeLookup && hasCodebaseLookup(active)));
    pi.setActiveTools(nextActiveTools(active, allowed));
    if (!allowed || !ctx.hasUI) return;
    const detected = await client.detectOpenWiki(ctx.signal).catch((error) => ({ available: false, error: error instanceof Error ? error.message : String(error) }));
    if (!detected.available) {
      ctx.ui.notify(`OpenWiki CLI unavailable: ${detected.error ?? "command not found"}. Run /openwiki doctor.`, "warning");
      return;
    }
    if (shouldNudge(drift, config)) {
      ctx.ui.notify(drift.indexExists ? "OpenWiki index may be stale. Run /openwiki doctor or /openwiki update." : "OpenWiki index appears missing. Run /openwiki doctor or /openwiki update.", "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    const active = pi.getActiveTools();
    if (!hasCodebaseLookup(active) || !OPENWIKI_TOOL_NAMES.every((name) => active.includes(name))) return;
    return { systemPrompt: `${event.systemPrompt}\n\nFor broad codebase orientation, architecture questions, locating relevant files, or planning code changes, use OpenWiki first as a table of contents before falling back to direct file reads/searches.` };
  });

  pi.registerCommand("openwiki", {
    description: "OpenWiki commands: doctor, setup, init, update, install, enable, disable",
    handler: async (args, ctx) => {
      const [sub = "doctor"] = args.trim().split(/\s+/);
      const { config, client, drift } = getRuntime(ctx.cwd);
      if (["doctor", "status"].includes(sub)) {
        const detected = await client.detectOpenWiki(ctx.signal);
        const next = !detected.available
          ? "Install OpenWiki with `npm install -g openwiki`, or configure the command in project/global openwiki.json."
          : !drift.indexExists
            ? "Run /openwiki init to generate the initial wiki, or run `openwiki --init` in this repository."
            : shouldNudge(drift, config)
              ? "Run /openwiki update if you want to refresh the existing wiki."
              : "OpenWiki is ready.";
        ctx.ui.notify(`OpenWiki doctor\nCLI: ${detected.available ? "available" : `unavailable (${detected.error})`}\nWiki: ${drift.indexExists ? drift.indexPath : "missing"}\nCapability gate: ${hasCodebaseLookup(pi.getActiveTools()) ? "allowed" : "blocked"}\nNext: ${next}`, "info");
        return;
      }
      if (sub === "init" || sub === "update") {
        if (ctx.hasUI) {
          const action = sub === "init" ? "Initialize" : "Update";
          const flag = sub === "init" ? "--init" : "--update";
          const ok = await ctx.ui.confirm(`${action} OpenWiki?`, `This runs \`openwiki ${flag} --print\` and may burn tokens/API usage. Continue?`);
          if (!ok) return;
        }
        const result = sub === "init" ? await client.runInit({}, ctx.signal) : await client.runUpdate({}, ctx.signal);
        ctx.ui.notify(result.text || `OpenWiki ${sub === "init" ? "initialization" : "update"} completed.`, "info");
        return;
      }
      if (sub === "install") {
        ctx.ui.notify("Install OpenWiki with `npm install -g openwiki`, then run `openwiki --init` in a repository. This Pi package reads the generated `openwiki/` docs and uses `openwiki --update --print` for explicit updates.", "info");
        return;
      }
      if (sub === "enable" || sub === "disable") {
        const path = projectConfigPath(ctx.cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ enabled: sub === "enable" }, null, 2) + "\n");
        ctx.ui.notify(`OpenWiki ${sub}d in ${path}. Run /reload if tools do not refresh immediately.`, "info");
        return;
      }
      if (sub === "setup") {
        if (!ctx.hasUI) return;
        const managedBy = await ctx.ui.select("How is OpenWiki kept fresh?", ["manual", "git-hooks", "ci-committed", "ci-remote", "ci-check-only", "unknown", "none"]);
        const nudge = await ctx.ui.select("When should Pi mention drift?", ["off", "missing-only", "significant-drift", "any-drift"]);
        const path = projectConfigPath(ctx.cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ enabled: true, freshness: { managedBy, nudge, autoUpdate: false } }, null, 2) + "\n");
        ctx.ui.notify(`Saved OpenWiki setup to ${path}.`, "info");
        return;
      }
      ctx.ui.notify("Unknown /openwiki command. Try: doctor, setup, init, update, install, enable, disable", "warning");
    },
  });
}
