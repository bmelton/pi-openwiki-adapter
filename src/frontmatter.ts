// Minimal reader for the OKF front matter OpenWiki 0.5 writes on every page: scalar strings, inline `[a, b]` lists and
// block `- item` lists. Enough for title/type/description/tags/status/timestamp; anything fancier is left as a string.
// Deliberately dependency-free (the package has no runtime dependencies).
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export type FrontMatter = Record<string, string | string[]>;

export function splitFrontMatter(content: string): { fields?: FrontMatter; body: string } {
  const m = BLOCK.exec(content);
  if (!m) return { body: content };
  return { fields: parseBlock(m[1]), body: content.slice(m[0].length) };
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"');
  return t;
}

function parseBlock(block: string): FrontMatter {
  const out: FrontMatter = {};
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest === "" || rest === "|" || rest === ">") {
      // block list or block scalar
      const items: string[] = [];
      const scalar: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        const next = lines[++i];
        const li = /^\s+-\s*(.*)$/.exec(next);
        if (li) items.push(unquote(li[1])); else scalar.push(next.trim());
      }
      out[key] = items.length ? items : scalar.join(" ");
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      out[key] = rest.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else {
      out[key] = unquote(rest.replace(/\s+#.*$/, ""));
    }
  }
  return out;
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []);

/** The fields the tools care about, normalized. */
export function pageMeta(fields: FrontMatter | undefined) {
  return {
    title: str(fields?.title),
    type: str(fields?.type),
    description: str(fields?.description),
    status: str(fields?.status),
    tags: list(fields?.tags),
    timestamp: str(fields?.timestamp),
    generated: fields?.openwiki_generated !== undefined,
  };
}

/** One compact line standing in for the YAML block when a page is shown to the model. */
export function metaLine(fields: FrontMatter | undefined): string | undefined {
  const m = pageMeta(fields);
  if (!m.title && !m.description && !m.type) return undefined;
  const bits = [m.title && `**${m.title}**`, m.type, m.status && m.status !== "stable" ? `status: ${m.status}` : undefined, m.tags.length ? `tags: ${m.tags.join(", ")}` : undefined, m.timestamp && `as of ${m.timestamp.slice(0, 10)}`].filter(Boolean);
  return [bits.join(" · "), m.description].filter(Boolean).join("\n");
}
