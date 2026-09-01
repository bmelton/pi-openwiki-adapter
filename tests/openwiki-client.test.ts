import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { OpenWikiClient } from "../src/openwiki-client.js";
import type { ResolvedOpenWikiConfig } from "../src/types.js";

function config(command: string, cwd: string): ResolvedOpenWikiConfig {
  return {
    ...DEFAULT_CONFIG,
    openwiki: {
      ...DEFAULT_CONFIG.openwiki,
      command,
      cwd,
    },
  };
}

describe("OpenWikiClient", () => {
  it("detects the real CLI via --help output instead of unsupported --version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-client-"));
    const cli = join(dir, "openwiki");
    writeFileSync(cli, "#!/usr/bin/env bash\nif [[ \"$1\" == \"--help\" ]]; then echo 'OpenWiki v0.4.3'; exit 0; fi\nif [[ \"$1\" == \"--version\" ]]; then echo 'Unknown option: --version' >&2; exit 1; fi\nexit 1\n");
    chmodSync(cli, 0o755);

    const detected = await new OpenWikiClient(config(cli, dir)).detectOpenWiki();

    expect(detected).toEqual({ available: true, version: "0.4.3" });
  });

  it("runs init in non-interactive print mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-client-"));
    const cli = join(dir, "openwiki");
    const argsFile = join(dir, "args.txt");
    writeFileSync(cli, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\necho initialized\n`);
    chmodSync(cli, 0o755);

    const result = await new OpenWikiClient(config(cli, dir)).runInit();

    expect(result.text).toBe("initialized");
    expect(readArgs(argsFile)).toEqual(["--init", "--print"]);
  });
});

function readArgs(path: string): string[] {
  return readFileSync(path, "utf8").trim().split(/\n/);
}
