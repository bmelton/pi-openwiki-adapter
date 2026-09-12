import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveConfig, truncateText, projectConfigPath } from "../src/config.js";
import { hasCodebaseLookup, nextActiveTools, OPENWIKI_TOOL_NAMES } from "../src/capabilities.js";
import { OpenWikiClient } from "../src/openwiki-client.js";
import { computeDrift, formatUpdateSuggestion, shouldNudge } from "../src/freshness.js";
import { formatDuration, formatRunProgress, formatRunStatusLine, readRunProgress } from "../src/run-progress.js";
import { countClaims } from "../src/metadata.js";
import { describeEvidenceBlockers, scanClaimsEvidence } from "../src/claims.js";

const STATUS_KEY = "openwiki";
const POLL_INTERVAL_MS = 2_000;

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export default function (pi: ExtensionAPI) {
  // One poller per extension instance, shared by the command path and the event path.
  let poller: ReturnType<typeof setInterval> | undefined;

  const stopPolling = (ctx: ExtensionContext) => {
    if (poller) clearInterval(poller);
    poller = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  };

  /** Drive the footer status line from the checkpoint until `stop` returns true and the checkpoint is gone. */
  const startPolling = (ctx: ExtensionContext, startedAtMs: number, isCommandRun: boolean) => {
    if (poller || !ctx.hasUI) return;
    poller = setInterval(() => {
      const progress = readRunProgress(ctx.cwd);
      if (progress && (isCommandRun || progress.live)) {
        ctx.ui.setStatus(STATUS_KEY, formatRunStatusLine(progress));
      } else if (isCommandRun) {
        // OpenWiki writes no checkpoint until the plan lands, so show elapsed time meanwhile.
        ctx.ui.setStatus(STATUS_KEY, `openwiki: starting · ${formatDuration(Date.now() - startedAtMs)}`);
      } else {
        stopPolling(ctx);
      }
    }, POLL_INTERVAL_MS);
  };

  /** Reflect an externally started run in the footer. Cheap enough to call once per turn. */
  const syncRunStatus = (ctx: ExtensionContext) => {
    const progress = readRunProgress(ctx.cwd);
    if (!ctx.hasUI) return progress;
    if (progress?.live) {
      ctx.ui.setStatus(STATUS_KEY, formatRunStatusLine(progress));
      startPolling(ctx, Date.now(), false);
    } else if (!progress && poller) {
      stopPolling(ctx);
    }
    return progress;
  };

  const requireCodeLookup = () => {
    const active = pi.getActiveTools();
    if (!hasCodebaseLookup(active)) {
      throw new Error("OpenWiki access requires codebase lookup capability (read, grep, find, or ls). This session does not have it.");
    }
  };

  const getRuntime = (cwd: string) => {
    const { config, paths } = resolveConfig(cwd);
    return { config, paths, client: new OpenWikiClient(config) };
  };

  pi.registerTool({
    name: "openwiki_status",
    label: "OpenWiki Status",
    description: "Report OpenWiki CLI availability, generated wiki status, configuration, and git-based freshness state.",
    promptSnippet: "Report OpenWiki availability, index status, and freshness.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, paths, client } = getRuntime(ctx.cwd);
      const drift = computeDrift(ctx.cwd, config);
      const progress = readRunProgress(ctx.cwd);
      const detected = await client.detectOpenWiki(signal);
      const claims = countClaims(ctx.cwd);
      const evidence = scanClaimsEvidence(ctx.cwd);
      const blockers = describeEvidenceBlockers(evidence);
      const lu = drift.lastUpdate;
      return textResult([
        `OpenWiki enabled: ${config.enabled}`,
        `OpenWiki command: ${config.openwiki.command} ${config.openwiki.args.join(" ")}`.trim(),
        `OpenWiki available: ${detected.available}${detected.version ? ` (v${detected.version}${detected.path ? `, ${detected.path}` : ""})` : ""}`,
        detected.error ? `OpenWiki error: ${detected.error}` : undefined,
        `Project config: ${paths.project}`,
        `Global config: ${paths.global}`,
        `Index: ${drift.indexExists ? `found at ${drift.indexPath}` : "missing"}${drift.pageCount ? ` (${drift.pageCount} pages${claims !== undefined ? `, ${claims} Claims records` : ""})` : ""}`,
        lu ? `Last run: ${lu.command} at ${lu.updatedAt} by ${lu.model}${lu.gitHead ? ` @ ${lu.gitHead.slice(0, 12)}` : ""}${lu.status === "interrupted" ? " (INTERRUPTED)" : ""}` : drift.indexExists ? "Last run: unknown (no .last-update.json; wiki predates OpenWiki 0.5)" : undefined,
        `Freshness: managedBy=${config.freshness.managedBy}, nudge=${config.freshness.nudge}, baseline=${drift.baseline}`,
        drift.commitsSince !== undefined ? `Commits since last run: ${drift.commitsSince}` : undefined,
        `Changed files since last run: ${drift.changedFileCount} (${drift.uncommittedFileCount} uncommitted)`,
        drift.pagesBehind.length ? `Pages verified against an older head: ${drift.pagesBehind.length}` : undefined,
        drift.staleBecause.length ? `Drift:\n${drift.staleBecause.map((x) => `- ${x}`).join("\n")}` : "Drift: no significant drift detected",
        evidence ? `Claim evidence: ${evidence.resources.length} cited files${evidence.missing.length ? `, ${evidence.missing.length} missing (pages will be reworked)` : ""}${evidence.symlinks.length ? `, ${evidence.symlinks.length} symlinked (BLOCKS runs)` : ""}` : undefined,
        blockers,
        progress ? formatRunProgress(progress) : "OpenWiki run: none in progress",
      ].filter(Boolean).join("\n"), { detected, drift, progress, claims, evidence, configPath: paths.project });
    },
  });

  pi.registerTool({
    name: "openwiki_outline",
    label: "OpenWiki Outline",
    description: "Return a compact OpenWiki table of contents for the current codebase, optionally focused by path/module/query.",
    promptSnippet: "Get a compact OpenWiki codebase table of contents.",
    promptGuidelines: ["Use openwiki_outline first for broad codebase orientation, architecture questions, locating relevant files, or planning code changes."],
    parameters: Type.Object({ focus: Type.Optional(Type.String()), budget: Type.Optional(Type.Number()) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.outlineChars, config.tokenBudget.outlineChars);
      const result = await client.getOutline({ focus: params.focus });
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.searchResultChars, config.tokenBudget.searchResultChars);
      const maxResults = Math.min(params.maxResults ?? config.tokenBudget.maxResults, config.tokenBudget.maxResults);
      const result = await client.search({ query: params.query, maxResults });
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      requireCodeLookup();
      const { config, client } = getRuntime(ctx.cwd);
      const budget = Math.min(params.budget ?? config.tokenBudget.pageChars, config.tokenBudget.pageChars);
      const result = await client.readPageOrSection({ id: params.id });
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
      const { config } = getRuntime(ctx.cwd);
      const drift = computeDrift(ctx.cwd, config);
      const progress = readRunProgress(ctx.cwd);
      const suggestion = formatUpdateSuggestion(drift, config);
      const text = progress?.live
        ? `${formatRunProgress(progress)}\nDo not start another OpenWiki run while this one works.\n\n${suggestion}`
        : suggestion;
      return textResult(text, { drift, progress });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const { config, client } = getRuntime(ctx.cwd);
    const active = pi.getActiveTools();
    const allowed = config.enabled && config.tools.autoEnableForCodeLookup && hasCodebaseLookup(active);
    pi.setActiveTools(nextActiveTools(active, allowed));
    if (!allowed || !ctx.hasUI) return;
    const detected = await client.detectOpenWiki(ctx.signal).catch((error) => ({ available: false, error: error instanceof Error ? error.message : String(error) }));
    if (!detected.available) {
      ctx.ui.notify(`OpenWiki CLI unavailable: ${detected.error ?? "command not found"}. Run /openwiki doctor.`, "warning");
      return;
    }
    const drift = computeDrift(ctx.cwd, config);
    if (shouldNudge(drift, config)) {
      ctx.ui.notify(drift.indexExists ? "OpenWiki index may be stale. Run /openwiki doctor or /openwiki update." : "OpenWiki index appears missing. Run /openwiki doctor or /openwiki update.", "info");
    }
    const progress = syncRunStatus(ctx);
    if (progress?.live) ctx.ui.notify(formatRunProgress(progress), "info");
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!hasCodebaseLookup(pi.getActiveTools())) return;
    syncRunStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopPolling(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    const active = pi.getActiveTools();
    if (!hasCodebaseLookup(active) || !OPENWIKI_TOOL_NAMES.every((name) => active.includes(name))) return;
    return { systemPrompt: `${event.systemPrompt}\n\nFor broad codebase orientation, architecture questions, locating relevant files, or planning code changes, use OpenWiki first as a table of contents before falling back to direct file reads/searches.` };
  });

  pi.registerCommand("openwiki", {
    description: "OpenWiki commands: doctor, setup, init, update, visualize, install, enable, disable",
    handler: async (args, ctx) => {
      const [sub = "doctor"] = args.trim().split(/\s+/);
      const { config, client } = getRuntime(ctx.cwd);
      if (["doctor", "status"].includes(sub)) {
        const drift = computeDrift(ctx.cwd, config);
        const progress = readRunProgress(ctx.cwd);
        const detected = await client.detectOpenWiki(ctx.signal);
        // Doctor reports drift even when nudges are switched off, because the user asked.
        const blockers = describeEvidenceBlockers(scanClaimsEvidence(ctx.cwd));
        const next = !detected.available
          ? "Install OpenWiki with `npm install -g openwiki`, or configure the command in project/global openwiki.json."
          : progress?.live
            ? "An OpenWiki run is in progress. Wait for it to finish before starting another."
            : !drift.indexExists
              ? "Run /openwiki init to generate the initial wiki, or run `openwiki --init` in this repository."
              : blockers
                ? blockers
              : drift.staleBecause.length
                ? "Run /openwiki update if you want to refresh the existing wiki."
                : "OpenWiki is ready.";
        const lu = drift.lastUpdate;
        ctx.ui.notify(`OpenWiki doctor\nCLI: ${detected.available ? `available${detected.version ? ` (v${detected.version})` : ""}` : `unavailable (${detected.error})`}\nWiki: ${drift.indexExists ? `${drift.indexPath}${drift.pageCount ? ` · ${drift.pageCount} pages` : ""}` : "missing"}\nLast run: ${lu ? `${lu.command} ${lu.updatedAt.slice(0, 16)} by ${lu.model}${lu.status === "interrupted" ? " (INTERRUPTED)" : ""}` : "unknown"}\nSince then: ${drift.commitsSince !== undefined ? `${drift.commitsSince} commits, ` : ""}${drift.changedFileCount} files changed\nCapability gate: ${hasCodebaseLookup(pi.getActiveTools()) ? "allowed" : "blocked"}\nRun: ${progress ? formatRunStatusLine(progress) + (progress.live ? "" : " (stale checkpoint)") : "none in progress"}\nNext: ${next}`, "info");
        return;
      }
      if (sub === "init" || sub === "update") {
        const action = sub === "init" ? "Initialize" : "Update";
        const flag = sub === "init" ? "--init" : "--update";
        const progress = readRunProgress(ctx.cwd);
        // Two writers against one checkpoint corrupt the run, so a live run needs an explicit override.
        if (progress?.live) {
          if (!ctx.hasUI) {
            ctx.ui.notify(`An OpenWiki ${progress.mode} run is already in progress (${formatRunStatusLine(progress)}). Not starting another.`, "warning");
            return;
          }
          const override = await ctx.ui.confirm("OpenWiki run already in progress", `${formatRunProgress(progress)}\n\nStarting a second run can corrupt the shared checkpoint. Continue anyway?`);
          if (!override) return;
        }
        if (ctx.hasUI) {
          const resumeNote = progress && !progress.live ? " A previous run was interrupted, so OpenWiki resumes from its checkpoint." : "";
          const ok = await ctx.ui.confirm(`${action} OpenWiki?`, `This runs \`openwiki ${flag} --print\` and may burn tokens/API usage.${resumeNote} Continue?`);
          if (!ok) return;
        }
        // OpenWiki's claims preflight aborts the whole run on symlinked evidence; say so now instead of after a failed spawn.
        const blockers = sub === "update" ? describeEvidenceBlockers(scanClaimsEvidence(ctx.cwd)) : undefined;
        if (blockers) { ctx.ui.notify(blockers, "error"); return; }
        const startedAtMs = Date.now();
        startPolling(ctx, startedAtMs, true);
        try {
          const result = sub === "init" ? await client.runInit(ctx.signal) : await client.runUpdate(ctx.signal);
          ctx.ui.notify(`${result.text || `OpenWiki ${sub === "init" ? "initialization" : "update"} completed.`}\n\nRan for ${formatDuration(Date.now() - startedAtMs)}.`, "info");
        } catch (error) {
          // Surface OpenWiki's own message as a notification rather than an extension crash; keep the elapsed time.
          const message = error instanceof Error ? error.message : String(error);
          const hint = /symbolic link/i.test(message) ? "\n\nA file cited as Claim evidence is a symlink; replace it with a regular file (see /openwiki doctor)." : /interrupted|checkpoint/i.test(message) ? "\n\nRerun to resume from the checkpoint." : "";
          ctx.ui.notify(`OpenWiki ${sub} failed after ${formatDuration(Date.now() - startedAtMs)}:\n${message}${hint}`, "error");
        } finally {
          stopPolling(ctx);
        }
        return;
      }
      if (sub === "visualize") {
        const detected = await client.detectOpenWiki(ctx.signal);
        if (!detected.available) { ctx.ui.notify(`OpenWiki CLI unavailable: ${detected.error}`, "error"); return; }
        const pid = client.visualize(args.trim().split(/\s+/).slice(1).filter(Boolean));
        ctx.ui.notify(`Started \`openwiki visualize\` (pid ${pid ?? "?"}); it serves the wiki graph locally (default port 4321) and opens your browser.`, "info");
        return;
      }
      if (sub === "install") {
        ctx.ui.notify("Install OpenWiki with `npm install -g openwiki` (needs Node 22+), then run `openwiki --init` in a repository. This Pi package reads the generated `openwiki/` docs and uses `openwiki --update --print` for explicit updates.", "info");
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
        const managedBy = await ctx.ui.select("How is OpenWiki kept fresh?", ["manual", "git-hooks", "ci", "unknown"]);
        const nudge = await ctx.ui.confirm("Mention drift?", "Notify at session start when the OpenWiki index looks stale?");
        const path = projectConfigPath(ctx.cwd);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ enabled: true, freshness: { managedBy, nudge } }, null, 2) + "\n");
        ctx.ui.notify(`Saved OpenWiki setup to ${path}.`, "info");
        return;
      }
      ctx.ui.notify("Unknown /openwiki command. Try: doctor, setup, init, update, visualize, install, enable, disable", "warning");
    },
  });
}
