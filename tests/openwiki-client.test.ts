import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
  it("detects the CLI via --help and reads the version from the owning package.json (0.5 prints none)", async () => {
    // layout of a global npm install: <prefix>/bin/openwiki -> ../lib/node_modules/openwiki/dist/cli/cli.js
    const prefix = mkdtempSync(join(tmpdir(), "ow-client-"));
    const pkgDir = join(prefix, "lib", "node_modules", "openwiki");
    mkdirSync(join(pkgDir, "dist", "cli"), { recursive: true });
    mkdirSync(join(prefix, "bin"));
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "openwiki", version: "0.5.1" }));
    const script = join(pkgDir, "dist", "cli", "cli.js");
    writeFileSync(script, "#!/usr/bin/env bash\nif [[ \"$1\" == \"--help\" ]]; then echo 'OpenWiki'; echo '  Run an agent that generates and maintains a project or local knowledge wiki.'; exit 0; fi\nexit 1\n");
    chmodSync(script, 0o755);
    const cli = join(prefix, "bin", "openwiki");
    symlinkSync(script, cli);

    const detected = await new OpenWikiClient(config(cli, prefix)).detectOpenWiki();
    expect(detected).toEqual({ available: true, version: "0.5.1", path: pkgDir });

    // still falls back to a version printed by --help when no package.json is reachable
    const bare = mkdtempSync(join(tmpdir(), "ow-client-"));
    const old = join(bare, "openwiki");
    writeFileSync(old, "#!/usr/bin/env bash\nif [[ \"$1\" == \"--help\" ]]; then echo 'OpenWiki v0.4.3'; exit 0; fi\nexit 1\n");
    chmodSync(old, 0o755);
    expect((await new OpenWikiClient(config(old, bare)).detectOpenWiki()).version).toBe("0.4.3");
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

describe("child process lifecycle", () => {
  it("tracks a running update and stops it on demand", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ow-client-"));
    const cli = join(dir, "openwiki");
    writeFileSync(cli, "#!/usr/bin/env bash\ntrap 'exit 143' TERM\nsleep 30 &\nwait\n");
    chmodSync(cli, 0o755);
    const client = new OpenWikiClient(config(cli, dir));
    const run = client.runUpdate();
    await new Promise((r) => setTimeout(r, 150));
    expect(client.children.size).toBe(1);
    expect(client.stopChildren()).toBe(1);
    await expect(run).rejects.toThrow();
    expect(client.children.size).toBe(0);
  });
});
