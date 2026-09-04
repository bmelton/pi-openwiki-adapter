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

/** Live state of an OpenWiki generation run, read from the `openwiki/.run.json` checkpoint. */
export type RunProgress = {
  runId: string;
  mode: "init" | "update";
  phase: "planning" | "generating";
  startedAt?: string;
  /** Planned page count. Zero while OpenWiki is still planning. */
  total: number;
  /** Pages that are complete or deliberately skipped. */
  done: number;
  /** Title of the first pending page. */
  current?: string;
  checkpointMtime: string;
  /** The checkpoint was written recently enough to treat the run as active. */
  live: boolean;
  elapsedMs?: number;
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
