#!/usr/bin/env node
/**
 * prism-mcp — run language-agnostic MCP over SoT cache
 *
 *   prism-mcp --cwd <project> [--lang <id>]
 *   prism-mcp serve --cwd <project>
 *   prism-mcp which
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

function usage(code = 0) {
  console.log(`prism-mcp — MCP server over Code Prism SoT cache

Usage:
  prism-mcp --cwd <project> [--lang <id>]
  prism-mcp serve --cwd <project> [--lang <id>]
  prism-mcp which

Env (also set automatically):
  PRISM_CWD           user project to point at
  CODE_PRISM_LANG     optional language filter (omit to merge all caches)

Examples:
  prism-mcp --cwd ~/Code/MyApp
  prism-mcp serve --cwd . --lang swift
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" || a === "--root") out.cwd = path.resolve(argv[++i]);
    else if (a === "--lang") out.lang = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      usage(2);
    } else out._.push(a);
  }
  return out;
}

function resolveMcpServer() {
  const home = os.homedir();
  const candidates = [
    path.join(home, "Documents", "Code", "mcp-prism", "dist", "server.js"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp-prism", "dist", "server.js"),
    process.env.CODE_PRISM_MCP_SERVER,
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  const cmd = args._[0];
  if (cmd === "which") {
    const server = resolveMcpServer();
    console.log(server || "(mcp-prism dist not found — build ~/Documents/Code/mcp-prism)");
    process.exit(server ? 0 : 1);
  }

  // Default / serve → run MCP stdio server
  if (cmd && cmd !== "serve") {
    console.error(`Unknown command: ${cmd}`);
    usage(2);
  }

  const cwd = args.cwd || process.env.PRISM_CWD || process.cwd();
  if (!fs.existsSync(cwd)) {
    console.error(`prism-mcp: cwd not found: ${cwd}`);
    process.exit(2);
  }

  const server = resolveMcpServer();
  if (!server) {
    console.error(
      "prism-mcp: mcp-prism server not found.\n  cd ~/Documents/Code/mcp-prism && npm install && npm run build"
    );
    process.exit(1);
  }

  const env = {
    ...process.env,
    PRISM_CWD: path.resolve(cwd),
  };
  if (args.lang) env.CODE_PRISM_LANG = args.lang;

  console.error(`[prism-mcp] PRISM_CWD=${env.PRISM_CWD}${args.lang ? ` CODE_PRISM_LANG=${args.lang}` : ""}`);
  console.error(`[prism-mcp] server=${server}`);

  const child = spawn(process.execPath, [server], {
    stdio: "inherit",
    env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
