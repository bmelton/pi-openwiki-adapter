export const OPENWIKI_TOOL_NAMES = [
  "openwiki_status",
  "openwiki_outline",
  "openwiki_search",
  "openwiki_read",
  "openwiki_update_suggestion",
] as const;

export const CODEBASE_LOOKUP_TOOLS = new Set(["read", "grep", "find", "ls"]);

export function hasCodebaseLookup(activeTools: string[]): boolean {
  return activeTools.some((tool) => CODEBASE_LOOKUP_TOOLS.has(tool));
}

export function nextActiveTools(activeTools: string[], allowOpenWiki: boolean): string[] {
  const base = activeTools.filter((tool) => !(OPENWIKI_TOOL_NAMES as readonly string[]).includes(tool));
  if (!allowOpenWiki) return base;
  return [...new Set([...base, ...OPENWIKI_TOOL_NAMES])];
}
