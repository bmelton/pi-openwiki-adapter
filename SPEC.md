# Pi OpenWiki Package Specification

## Goal

Build a Pi package that integrates LangChain OpenWiki with Pi Coding Agent so Pi sessions and code-research-capable sub-agents can use OpenWiki as a token-efficient codebase table of contents before falling back to direct file reads/searches.

The package must **not reimplement OpenWiki indexing, summarization, retrieval, or update logic**. It should wrap and orchestrate an installed OpenWiki implementation through its supported CLI/API.

## Non-Goals

- [ ] Do not automatically regenerate/update OpenWiki indexes without explicit user confirmation.
- [ ] Do not duplicate OpenWiki's indexing or summarization behavior.
- [ ] Do not expose OpenWiki to sessions/sub-agents that do not have codebase lookup permissions.
- [ ] Do not treat OpenWiki as general conversational memory.
- [ ] Do not require users to change their CI/update workflow.

## Core Concepts

### OpenWiki as Codebase TOC

OpenWiki should be used as a structured overview layer for:

- locating relevant files/directories/modules,
- understanding architecture and ownership boundaries,
- planning changes,
- narrowing direct file reads/searches,
- avoiding broad, token-heavy repo scans.

### Capability Boundary

OpenWiki access is considered equivalent to codebase read/research access because it can expose project structure, file names, APIs, architecture, and documentation.

A Pi session or sub-agent may use OpenWiki only if it has codebase lookup capability.

Codebase lookup capability is inferred from active tools/capabilities such as:

- `read`
- `grep`
- `find`
- `ls`
- planning/research sub-agent profile with codebase read access

If codebase lookup is not available, OpenWiki tools must be disabled or must refuse execution.

## Proposed Package Structure

```txt
pi-openwiki/
  package.json
  README.md
  SPEC.md
  extensions/
    openwiki.ts
  src/
    openwiki-client.ts
    config.ts
    freshness.ts
    capabilities.ts
    types.ts
  skills/
    openwiki-navigation/
      SKILL.md
  tests/
    ...
```

## Pi Package Manifest

- [ ] Add `pi-package` keyword.
- [ ] Declare extension path under `pi.extensions`.
- [ ] Optionally declare skill path under `pi.skills`.
- [ ] Put runtime dependencies in `dependencies`.
- [ ] Put Pi packages in `peerDependencies` with `"*"` where imported:
  - `@earendil-works/pi-coding-agent`
  - `typebox`
  - optionally `@earendil-works/pi-ai`

Example manifest shape:

```json
{
  "name": "pi-openwiki",
  "keywords": ["pi-package", "openwiki", "langchain", "codebase-navigation"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

## Configuration

Configuration should be per-project where possible, with global defaults supported.

Recommended project config path:

```txt
.pi/openwiki.json
```

Use Pi's exported `CONFIG_DIR_NAME` instead of hardcoding `.pi` in code.

### Config Schema

```ts
type OpenWikiConfig = {
  enabled?: boolean;

  openwiki?: {
    command?: string;
    args?: string[];
    cwd?: string;
  };

  tools?: {
    autoEnableForCodeLookup?: boolean;
    explicitEnabled?: boolean;
    explicitDisabled?: boolean;
  };

  freshness?: {
    managedBy?: "manual" | "git-hooks" | "ci-committed" | "ci-remote" | "ci-check-only" | "unknown" | "none";
    nudge?: "off" | "missing-only" | "significant-drift" | "any-drift";
    autoUpdate?: false;
    lastPromptedAt?: string;
    lastDismissedAt?: string;
    significantFileThreshold?: number;
  };

  tokenBudget?: {
    outlineChars?: number;
    searchResultChars?: number;
    pageChars?: number;
    maxResults?: number;
  };
};
```

### Defaults

- [ ] `enabled`: `true`
- [ ] `tools.autoEnableForCodeLookup`: `true`
- [ ] `freshness.managedBy`: `unknown`
- [ ] `freshness.nudge`: `significant-drift`
- [ ] `freshness.autoUpdate`: `false`
- [ ] `freshness.significantFileThreshold`: `10`
- [ ] Conservative character budgets for tool output

## Extension Behavior

### Startup / Session Start

On `session_start`:

- [ ] Load project/global OpenWiki config.
- [ ] Detect whether OpenWiki is installed/available.
- [ ] Detect whether the current workspace has an OpenWiki index.
- [ ] Determine whether active Pi tools/capabilities allow codebase lookup.
- [ ] Enable OpenWiki tools only when codebase lookup is allowed and package/config is enabled.
- [ ] Disable or keep disabled OpenWiki tools when codebase lookup is not allowed.
- [ ] Check freshness according to configured policy.
- [ ] Show a non-blocking notification when OpenWiki is missing or stale according to policy.
- [ ] Never update OpenWiki automatically on startup.

### Prompt/System Guidance

When OpenWiki tools are active, add concise guidance before agent start:

> For broad codebase orientation, architecture questions, locating relevant files, or planning code changes, use OpenWiki first as a table of contents before falling back to direct file reads/searches.

Checklist:

- [ ] Inject guidance only when OpenWiki tools are active.
- [ ] Keep guidance short to avoid token overhead.
- [ ] Do not inject guidance when OpenWiki is unavailable or disabled.
- [ ] Do not inject guidance into sessions without codebase lookup capability.

## Tools

All tools must be thin wrappers around OpenWiki CLI/API behavior.

### `openwiki_status`

Purpose: report OpenWiki availability, index status, config, and freshness state.

Checklist:

- [ ] Reports whether OpenWiki command/API is available.
- [ ] Reports detected OpenWiki version when possible.
- [ ] Reports whether an index exists for the current project.
- [ ] Reports freshness policy.
- [ ] Reports detected drift summary.
- [ ] Refuses execution when codebase lookup capability is absent.

### `openwiki_outline`

Purpose: return a compact table of contents for the current codebase.

Checklist:

- [ ] Calls OpenWiki outline/TOC/list API or CLI.
- [ ] Accepts optional focus/path/module query.
- [ ] Enforces output budget.
- [ ] Returns headings/sections before full content.
- [ ] Refuses execution when codebase lookup capability is absent.

### `openwiki_search`

Purpose: search OpenWiki for relevant pages/sections/files.

Checklist:

- [ ] Accepts query.
- [ ] Accepts optional max results.
- [ ] Accepts optional output budget.
- [ ] Returns ranked compact results.
- [ ] Prefers page/section identifiers that can be passed to `openwiki_read`.
- [ ] Refuses execution when codebase lookup capability is absent.

### `openwiki_read`

Purpose: expand a specific OpenWiki page/section/result.

Checklist:

- [ ] Accepts page/section/result identifier.
- [ ] Accepts optional output budget.
- [ ] Returns exact OpenWiki content without additional model rewriting.
- [ ] Includes source path/page metadata when available.
- [ ] Refuses execution when codebase lookup capability is absent.

### `openwiki_update_suggestion`

Purpose: explain whether the user should consider refreshing OpenWiki.

Checklist:

- [ ] Computes drift/freshness signals.
- [ ] Explains why an update may or may not be useful.
- [ ] Does not perform update.
- [ ] Refuses execution when codebase lookup capability is absent.

## Slash Commands

### `/openwiki doctor`

Checklist:

- [ ] Check OpenWiki installation.
- [ ] Check project index existence.
- [ ] Check configured freshness policy.
- [ ] Check capability gating status.
- [ ] Show clear next steps.

### `/openwiki setup`

Interactive setup flow.

Checklist:

- [ ] Ask how OpenWiki is kept fresh:
  - manual
  - git hooks
  - CI committed/published locally
  - CI remote
  - CI check only
  - unknown
  - none / do not remind
- [ ] Ask when Pi should mention drift:
  - never
  - missing only
  - significant drift
  - any drift
- [ ] Save answers to project config.
- [ ] Do not force index generation.

### `/openwiki update`

Explicit update command.

Checklist:

- [ ] Explain that updating may burn tokens or API usage.
- [ ] Ask for confirmation before running.
- [ ] Invoke OpenWiki's own update command/API.
- [ ] Stream progress where possible.
- [ ] Show success/failure clearly.
- [ ] Never run as an implicit side effect of another command.

### `/openwiki install`

Optional helper if the correct OpenWiki install mechanism is known.

Checklist:

- [ ] Detect current platform/package manager where reasonable.
- [ ] Show exact install command.
- [ ] Ask for confirmation before executing install.
- [ ] Prefer instructions over automatic install if uncertain.

### `/openwiki enable` and `/openwiki disable`

Checklist:

- [ ] Toggle project config.
- [ ] Call reload or instruct user to run `/reload` if needed.
- [ ] Do not override capability restrictions.

## Freshness / Drift Detection

Freshness nudges should be advisory and configurable.

### Signals

Use available signals without requiring OpenWiki internals where possible:

- [ ] Index missing.
- [ ] Index timestamp older than latest git commit.
- [ ] Current branch differs from indexed branch/commit if OpenWiki exposes that metadata.
- [ ] Number of changed files since index exceeds threshold.
- [ ] Important files changed since index:
  - package manifests and lockfiles
  - route files
  - schema/migration files
  - public API/interface files
  - config files
  - build tooling files
- [ ] Uncommitted changes exist and are relevant to current task.

### Policies

- [ ] `off`: never nudge about drift.
- [ ] `missing-only`: only mention missing OpenWiki/index.
- [ ] `significant-drift`: mention meaningful drift only.
- [ ] `any-drift`: mention any detected drift.

### CI/External Freshness Modes

If user says freshness is handled externally:

- [ ] `ci-committed`: assume local index is updated when repo is pulled; default nudge should be `missing-only` or `significant-drift`.
- [ ] `ci-remote`: verify local tool can read remote/current wiki before suppressing drift nudges.
- [ ] `ci-check-only`: do not assume local OpenWiki is fresh; keep `significant-drift` default.
- [ ] `git-hooks`: expect local updates, but still warn if index is missing or obviously stale.
- [ ] `manual`: default to `significant-drift`.
- [ ] `none` or `off`: avoid freshness nudges unless user runs doctor/status.

## Capability Gating

### Normal Pi Sessions

Checklist:

- [ ] Use `pi.getActiveTools()` to inspect active tool names.
- [ ] Treat `read`, `grep`, `find`, or `ls` as codebase lookup capability.
- [ ] Register OpenWiki tools during extension load.
- [ ] On session start, call `pi.setActiveTools()` to include OpenWiki tools only when allowed.
- [ ] Do not remove unrelated tools.
- [ ] Tool implementations defensively check capability before executing.

### Sub-Agents

Pi does not ship built-in sub-agents; sub-agent packages should pass capability profiles explicitly.

Recommended capability profile:

```ts
type SubAgentCapabilities = {
  codebaseRead?: boolean;
  codebaseWrite?: boolean;
  planning?: boolean;
  openWiki?: "auto" | true | false;
};
```

Rules:

- [ ] `openWiki: false` disables OpenWiki.
- [ ] `openWiki: true` allows OpenWiki only if `codebaseRead` or equivalent codebase lookup is also true.
- [ ] `openWiki: "auto"` enables OpenWiki when codebase lookup is available.
- [ ] Sub-agent wrapper should include OpenWiki tools in its allowed tool list only when the rules allow it.

## Token Budgeting

Checklist:

- [ ] Every OpenWiki content-producing tool accepts output budget controls.
- [ ] Defaults favor compact output.
- [ ] Search returns identifiers and summaries before full text.
- [ ] Outline returns headings/sections first.
- [ ] Read requires explicit page/section/result identifier.
- [ ] Tool output should state when results were truncated.

## OpenWiki Client Adapter

Create a small adapter layer so OpenWiki invocation details are isolated.

Checklist:

- [ ] Implement `detectOpenWiki()`.
- [ ] Implement `getStatus()`.
- [ ] Implement `getOutline()`.
- [ ] Implement `search()`.
- [ ] Implement `readPageOrSection()`.
- [ ] Implement `suggestUpdate()`.
- [ ] Implement `runUpdate()`.
- [ ] Support abort signals/timeouts.
- [ ] Do not parse or mutate OpenWiki internals beyond documented output/API.

Open question:

- [ ] Confirm exact OpenWiki package name, CLI command, API shape, index location, and update command.

## Security / Privacy

Checklist:

- [ ] Treat OpenWiki output as repository content subject to prompt injection risk.
- [ ] Do not expose OpenWiki in sessions without codebase lookup permission.
- [ ] Do not execute arbitrary commands from OpenWiki output.
- [ ] Do not log full OpenWiki content unless user opts in.
- [ ] Be clear that Pi packages/extensions run with local user permissions.
- [ ] Avoid install-time scripts that execute automatically.

## Testing Plan

### Unit Tests

- [ ] Config loading and defaults.
- [ ] Freshness policy decisions.
- [ ] Capability gating decisions.
- [ ] Token budget truncation.
- [ ] OpenWiki adapter command construction.
- [ ] Missing OpenWiki behavior.

### Integration Tests

- [ ] Pi session with `read` active gets OpenWiki tools.
- [ ] Pi session without code lookup tools does not get OpenWiki tools.
- [ ] `openwiki_status` works with mocked OpenWiki CLI/API.
- [ ] `openwiki_search` respects max results and budget.
- [ ] `/openwiki setup` writes project config.
- [ ] `/openwiki update` requires confirmation.
- [ ] Stale index produces a nudge only under matching policy.

### Manual Tests

- [ ] Fresh repo with no OpenWiki installed.
- [ ] Repo with OpenWiki installed but no index.
- [ ] Repo with fresh index.
- [ ] Repo with stale index.
- [ ] Repo where CI commits OpenWiki updates.
- [ ] Repo with uncommitted local changes.
- [ ] Read-only Pi session.
- [ ] No-tools Pi session.

## Implementation Phases

### Phase 0 — Discovery / API Confirmation

- [ ] Confirm exact LangChain OpenWiki project/package name.
- [ ] Confirm install command(s).
- [ ] Confirm CLI/API commands for status, outline, search, read, and update.
- [ ] Confirm index metadata availability: timestamp, commit, branch, changed files, source paths.
- [ ] Decide whether OpenWiki is an external peer requirement or package dependency.

Exit criteria:

- [ ] A documented OpenWiki adapter contract exists.

### Phase 1 — Pi Package Skeleton

- [ ] Create package structure.
- [ ] Add package manifest.
- [ ] Add extension entrypoint.
- [ ] Add config loader.
- [ ] Register placeholder commands/tools.
- [ ] Add README with install/use instructions.

Exit criteria:

- [ ] Package can be installed by Pi from a local path.
- [ ] `/openwiki doctor` runs and reports placeholder status.

### Phase 2 — Capability Gating

- [ ] Implement active-tool inspection.
- [ ] Enable OpenWiki tools for codebase lookup sessions.
- [ ] Disable OpenWiki tools otherwise.
- [ ] Add defensive runtime checks inside each OpenWiki tool.
- [ ] Add concise prompt guidance only when active.

Exit criteria:

- [ ] OpenWiki tools are visible/callable only in code-lookup-capable sessions.

### Phase 3 — OpenWiki Adapter MVP

- [ ] Implement OpenWiki availability detection.
- [ ] Implement status.
- [ ] Implement outline.
- [ ] Implement search.
- [ ] Implement read.
- [ ] Implement output truncation/budgeting.

Exit criteria:

- [ ] Agent can use OpenWiki to locate relevant code before direct reads/searches.

### Phase 4 — Freshness Policies

- [ ] Implement drift detection.
- [ ] Implement freshness policy evaluation.
- [ ] Implement startup nudges.
- [ ] Implement `openwiki_update_suggestion`.
- [ ] Implement `/openwiki setup`.
- [ ] Respect CI/manual/no-reminder modes.

Exit criteria:

- [ ] Users get useful, non-noisy freshness guidance without automatic updates.

### Phase 5 — Explicit Update / Install Helpers

- [ ] Implement `/openwiki update` with confirmation.
- [ ] Implement progress reporting.
- [ ] Implement `/openwiki install` if install process is reliable.
- [ ] Otherwise provide platform-specific instructions only.

Exit criteria:

- [ ] Users can intentionally refresh OpenWiki from Pi.

### Phase 6 — Hardening and Release

- [ ] Add test coverage.
- [ ] Add docs for package users.
- [ ] Add docs for sub-agent package authors.
- [ ] Verify package install from npm/git/local path.
- [ ] Verify no automatic update/index token burn.
- [ ] Publish initial version.

Exit criteria:

- [ ] Package is ready for external users.

## Definition of Done

- [ ] Pi package installs successfully.
- [ ] OpenWiki tools are gated by codebase lookup capability.
- [ ] Agent guidance encourages OpenWiki-first navigation when appropriate.
- [ ] OpenWiki unavailable/missing-index cases are handled gracefully.
- [ ] Freshness nudges are configurable and non-invasive.
- [ ] Updates require explicit user confirmation.
- [ ] No OpenWiki core functionality is reimplemented.
- [ ] README documents setup, commands, tools, config, and limitations.
