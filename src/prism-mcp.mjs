#!/usr/bin/env node
/**
 * prism-mcp — run language-agnostic MCP over SoT cache
 *
 * Simple forms:
 *   prism-mcp                         # cwd = process.cwd() / PRISM_CWD
 *   prism-mcp .                       # this folder
 *   prism-mcp ~/Code/MyApp            # path
 *   prism-mcp game                    # short name → cache slug / meta.projectRoot
 *   prism-mcp serve game
 *   prism-mcp which
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { cacheRoot } from "./plugins.mjs";

function usage(code = 0) {
  console.log(`prism-mcp — MCP over Code Prism SoT cache

Usage (simple):
  prism-mcp                    # use current directory
  prism-mcp .                  # same
  prism-mcp <path>             # project folder
  prism-mcp <name>             # short name (matches cache folder, e.g. "game")
  prism-mcp serve [target]
  prism-mcp which

Optional:
  --lang <id>                  filter one language (default: all caches for project)

Examples:
  prism-mcp game
  prism-mcp .
  prism-mcp ~/Documents/Code/iOS/LiteTrace --lang swift

MCP client config (simplest — no long --cwd):
  { "command": "prism-mcp", "args": ["game"] }
  { "command": "prism-mcp", "args": ["."] }   // if host cwd = workspace
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

function readMetaProjectRoot(dir) {
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    return meta.projectRoot && fs.existsSync(meta.projectRoot) ? meta.projectRoot : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a short target to an absolute project path.
 * - absolute/relative path that exists
 * - cache slug prefix: "game" → …/Caches/code-prism/game-<hash>/…/meta.json → projectRoot
 */
function resolveProjectTarget(target) {
  if (!target || target === ".") {
    return path.resolve(process.cwd());
  }

  const asPath = path.resolve(target);
  if (fs.existsSync(asPath)) return asPath;

  // Short name → scan cache project folders
  const root = cacheRoot();
  if (!fs.existsSync(root)) {
    throw new Error(`Unknown project '${target}' (no cache at ${root}). Run: prism analyze --root <path>`);
  }

  const needle = target.toLowerCase();
  const matches = [];
  for (const name of fs.readdirSync(root)) {
    const projDir = path.join(root, name);
    if (!fs.statSync(projDir).isDirectory()) continue;
    if (!name.toLowerCase().startsWith(needle) && !name.toLowerCase().includes(`-${needle}`)) {
      // also allow exact slug start: game-xxxx
      if (!name.toLowerCase().startsWith(`${needle}-`)) continue;
    }
    // find any {lang}-prism/meta.json
    let projectRoot = null;
    try {
      for (const ent of fs.readdirSync(projDir)) {
        if (!ent.endsWith("-prism")) continue;
        projectRoot = readMetaProjectRoot(path.join(projDir, ent));
        if (projectRoot) break;
      }
    } catch {
      continue;
    }
    if (projectRoot) matches.push({ slug: name, projectRoot });
  }

  if (matches.length === 1) return matches[0].projectRoot;
  if (matches.length > 1) {
    const list = matches.map((m) => `  ${m.slug} → ${m.projectRoot}`).join("\n");
    throw new Error(`Ambiguous name '${target}':\n${list}\nUse a fuller path or slug.`);
  }

  throw new Error(
    `Unknown project '${target}'. Use a folder path, or a cache name (e.g. after analyze: prism-mcp game).\n` +
      `Cache: ${root}`
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);

  let positional = [...args._];
  let cmd = null;
  if (positional[0] === "serve" || positional[0] === "which") {
    cmd = positional.shift();
  }

  if (cmd === "which") {
    const server = resolveMcpServer();
    console.log(server || "(mcp-prism dist not found — build ~/Documents/Code/mcp-prism)");
    process.exit(server ? 0 : 1);
  }

  // target: --cwd flag OR positional OR env OR cwd
  let cwd;
  try {
    if (args.cwd) cwd = args.cwd;
    else if (positional[0]) cwd = resolveProjectTarget(positional[0]);
    else if (process.env.PRISM_CWD) cwd = path.resolve(process.env.PRISM_CWD);
    else cwd = path.resolve(process.cwd());
  } catch (err) {
    console.error(`prism-mcp: ${err.message || err}`);
    process.exit(2);
  }

  if (!fs.existsSync(cwd)) {
    console.error(`prism-mcp: project not found: ${cwd}`);
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

  console.error(`[prism-mcp] PRISM_CWD=${env.PRISM_CWD}${args.lang ? ` lang=${args.lang}` : " (all langs)"}`);
  console.error(`[prism-mcp] server=${server}`);

  const child = spawn(process.execPath, [server], {
    stdio: "inherit",
    env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
