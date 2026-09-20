#!/usr/bin/env node
/**
 * prism — unified backend CLI
 *
 *   prism plugins
 *   prism detect --root <project>
 *   prism cache --root <project>
 *   prism analyze --root <project> [--lang auto|id]
 *   prism <lang> --root <project> [--out <json>]
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { cacheDirFor, projectSlug } from "./cache.mjs";
import { detectLanguages } from "./detect.mjs";
import { discoverPlugins, findPlugin } from "./plugins.mjs";

function usage(code = 0) {
  console.log(`prism — Code Prism backend CLI

Usage:
  prism plugins
  prism detect  --root <project>
  prism cache   --root <project>
  prism analyze --root <project> [--lang auto|<id>]
  prism <lang>  --root <project> [--out <json>] [--lang <id>]

Examples:
  prism analyze --root ~/Code/MyApp
  prism swift --root ~/Code/MyApp
  prism js --root ~/Code/web

Env:
  CODE_PRISM_BACKEND_<ID>   override binary path for a plugin
`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--out") out.out = path.resolve(argv[++i]);
    else if (a === "--lang") out.lang = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a.startsWith("-")) {
      console.error(`Unknown flag: ${a}`);
      usage(2);
    } else out._.push(a);
  }
  return out;
}

function runBinary(binaryPath, args, env = {}) {
  const res = spawnSync(binaryPath, args, {
    encoding: "utf-8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(res.stderr || `exit ${res.status}`);
  }
}

function findSwiftFiles(root) {
  const skip = new Set([".build", "DerivedData", "Pods", "node_modules", ".git"]);
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name) || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".swift")) out.push(p);
    }
  };
  walk(root);
  return out;
}

function runPlugin(plugin, root, outPath) {
  if (!plugin.binaryPath || !fs.existsSync(plugin.binaryPath)) {
    throw new Error(`Plugin '${plugin.id}' binary not found: ${plugin.binaryPath || "(none)"}`);
  }
  const destDir = path.dirname(outPath);
  fs.mkdirSync(destDir, { recursive: true });

  if (plugin.id === "swift" || (plugin.extensions.length === 1 && plugin.extensions[0] === "swift")) {
    const files = findSwiftFiles(root);
    if (files.length === 0) throw new Error("No .swift files");
    runBinary(plugin.binaryPath, [
      "--workspace",
      root,
      "--scan-targets",
      "--public-only-external",
      "--context",
      "--output",
      outPath,
      ...files,
    ]);
  } else {
    runBinary(
      plugin.binaryPath,
      ["--root", root, "--out", outPath, "--lang", plugin.id],
      { CODE_PRISM_LANG: plugin.id, PRISM_EXTS: plugin.extensions.join(",") }
    );
  }

  const meta = {
    projectRoot: fs.realpathSync(root),
    language: plugin.id,
    cacheFolder: plugin.cacheFolder,
    projectSlug: projectSlug(root),
    generatedAt: new Date().toISOString(),
    sot: { json: outPath, sqlite: path.join(destDir, "graph.sqlite") },
  };
  fs.writeFileSync(path.join(destDir, "meta.json"), JSON.stringify(meta, null, 2));
  return { outPath, cacheDir: destDir, meta };
}

function cmdPlugins() {
  const list = discoverPlugins();
  if (list.length === 0) {
    console.log("No plugins found.");
    process.exit(1);
  }
  for (const p of list) {
    const ok = p.binaryPath && fs.existsSync(p.binaryPath) ? "ok" : "missing-bin";
    console.log(`${p.id}\t${p.name}\t${p.cacheFolder}\t${ok}\t${p.binaryPath || ""}`);
  }
}

function cmdDetect(root) {
  const hits = detectLanguages(root);
  console.log(JSON.stringify({ root: fs.realpathSync(root), languages: hits.map(({ plugin, ...h }) => h) }, null, 2));
}

function cmdCache(root) {
  const slug = projectSlug(root);
  const dir = path.join(path.dirname(cacheDirFor(root, "swift")), "..");
  // project cache dir
  const projectDir = path.join(
    path.join(process.env.HOME || "", "Library", "Caches", "code-prism"),
    slug
  );
  const langs = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).filter((n) => n.endsWith("-prism"))
    : [];
  console.log(JSON.stringify({ root: fs.realpathSync(root), projectSlug: slug, cacheDir: projectDir, languages: langs }, null, 2));
}

function cmdAnalyze(root, langOpt) {
  const detected = detectLanguages(root);
  const targets =
    !langOpt || langOpt === "auto"
      ? detected
      : detected.filter((d) => d.id === langOpt || d.id === String(langOpt).replace(/-prism$/, ""));
  if (targets.length === 0) {
    throw new Error(`No matching language for --lang ${langOpt}`);
  }
  const results = [];
  for (const t of targets) {
    const plugin = t.plugin || findPlugin(t.id);
    if (!plugin) throw new Error(`Plugin not found: ${t.id}`);
    const outPath = path.join(cacheDirFor(root, plugin.id, plugin.cacheFolder), "prism-context.json");
    const r = runPlugin(plugin, root, outPath);
    results.push({ language: plugin.id, ...r.meta.sot, cacheDir: r.cacheDir });
  }
  console.log(JSON.stringify({ ok: true, projectSlug: projectSlug(root), results }, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) usage(args.help ? 0 : 2);

  const cmd = args._[0];
  const rest = args._.slice(1);

  try {
    if (cmd === "plugins") return cmdPlugins();
    if (cmd === "detect") {
      if (!args.root) throw new Error("--root required");
      return cmdDetect(args.root);
    }
    if (cmd === "cache") {
      if (!args.root) throw new Error("--root required");
      return cmdCache(args.root);
    }
    if (cmd === "analyze") {
      if (!args.root) throw new Error("--root required");
      return cmdAnalyze(args.root, args.lang || "auto");
    }

    // prism <lang> --root ...
    const lang = cmd;
    if (!args.root) throw new Error("--root required");
    const plugin = findPlugin(lang);
    if (!plugin) {
      console.error(`Unknown plugin '${lang}'. Try: prism plugins`);
      process.exit(2);
    }
    const outPath =
      args.out || path.join(cacheDirFor(args.root, plugin.id, plugin.cacheFolder), "prism-context.json");
    const r = runPlugin(plugin, args.root, outPath);
    console.log(JSON.stringify({ ok: true, language: plugin.id, cacheDir: r.cacheDir, json: r.outPath }, null, 2));
  } catch (err) {
    console.error(`prism: ${err.message || err}`);
    process.exit(1);
  }
}

main();
