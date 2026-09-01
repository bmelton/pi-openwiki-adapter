export type FreshnessManagedBy =
  | "manual"
  | "git-hooks"
  | "ci-committed"
  | "ci-remote"
  | "ci-check-only"
  | "unknown"
  | "none";

export type FreshnessNudge = "off" | "missing-only" | "significant-drift" | "any-drift";

export type McpToolMap = {
  status?: string;
  outline?: string;
  search?: string;
  read?: string;
  update?: string;
};

export type OpenWikiConfig = {
  enabled?: boolean;
  openwiki?: {
    command?: string;
    args?: string[];
    cwd?: string;
    timeoutMs?: number;
    toolMap?: McpToolMap;
  };
  tools?: {
    autoEnableForCodeLookup?: boolean;
    explicitEnabled?: boolean;
    explicitDisabled?: boolean;
  };
  freshness?: {
    managedBy?: FreshnessManagedBy;
    nudge?: FreshnessNudge;
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

export type ResolvedOpenWikiConfig = Required<Omit<OpenWikiConfig, "openwiki" | "tools" | "freshness" | "tokenBudget">> & {
  openwiki: Required<Omit<NonNullable<OpenWikiConfig["openwiki"]>, "toolMap">> & { toolMap: Required<McpToolMap> };
  tools: Required<NonNullable<OpenWikiConfig["tools"]>>;
  freshness: Required<NonNullable<OpenWikiConfig["freshness"]>>;
  tokenBudget: Required<NonNullable<OpenWikiConfig["tokenBudget"]>>;
};

export type DriftSummary = {
  indexExists: boolean;
  indexPath?: string;
  changedFiles: string[];
  changedFileCount: number;
  importantChangedFiles: string[];
  latestCommit?: string;
  latestCommitTime?: string;
  indexMtime?: string;
  staleBecause: string[];
  significant: boolean;
};
