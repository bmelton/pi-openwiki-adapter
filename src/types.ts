export type ResolvedOpenWikiConfig = {
  enabled: boolean;
  openwiki: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
  };
  tools: {
    autoEnableForCodeLookup: boolean;
  };
  freshness: {
    /** Free-form label for how the wiki is refreshed. Reported, never branched on. */
    managedBy: string;
    nudge: boolean;
    significantFileThreshold: number;
  };
  tokenBudget: {
    outlineChars: number;
    searchResultChars: number;
    pageChars: number;
    maxResults: number;
  };
};

export type OpenWikiConfig = {
  enabled?: boolean;
  openwiki?: Partial<ResolvedOpenWikiConfig["openwiki"]>;
  tools?: Partial<ResolvedOpenWikiConfig["tools"]>;
  freshness?: Partial<ResolvedOpenWikiConfig["freshness"]>;
  tokenBudget?: Partial<ResolvedOpenWikiConfig["tokenBudget"]>;
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
};
