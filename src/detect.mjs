import fs from "fs";
import path from "path";
import { canDetectLanguage, discoverPlugins } from "./plugins.mjs";

const SKIP = new Set([
  ".build", "DerivedData", "Pods", "node_modules", ".git", "Carthage",
  "dist", "target", ".next", ".turbo", "__pycache__", ".venv", "vendor",
]);

/**
 * Detect languages from **installed plugins only**.
 * Extensions with no plugin (e.g. .lua without lua-prism) are ignored — no SoT/nodes.
 */
export function detectLanguages(projectRoot) {
  const plugins = discoverPlugins().filter(canDetectLanguage);
  if (plugins.length === 0) {
    throw new Error(
      "No Code Prism backends found. Clone into ~/Documents/Code/code-prism/backends/*-prism"
    );
  }

  const counts = new Map(plugins.map((p) => [p.id, 0]));
  const files = new Map(plugins.map((p) => [p.id, 0]));
  const markersHit = new Map();

  for (const plugin of plugins) {
    for (const marker of plugin.markers) {
      if (fs.existsSync(path.join(projectRoot, marker))) {
        counts.set(plugin.id, (counts.get(plugin.id) || 0) + 50);
        const arr = markersHit.get(plugin.id) || [];
        arr.push(marker);
        markersHit.set(plugin.id, arr);
      }
    }
  }

  const extToLang = new Map();
  for (const plugin of plugins) {
    for (const ext of plugin.extensions) {
      if (!extToLang.has(ext)) extToLang.set(ext, plugin.id);
    }
  }

  walk(projectRoot, (file) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    const lang = extToLang.get(ext);
    if (!lang) return;
    counts.set(lang, (counts.get(lang) || 0) + 1);
    files.set(lang, (files.get(lang) || 0) + 1);
  });

  const results = [];
  for (const plugin of plugins) {
    const score = counts.get(plugin.id) || 0;
    if (score <= 0) continue;
    const nFiles = files.get(plugin.id) || 0;
    const notes = markersHit.get(plugin.id) || [];
    if (nFiles === 0 && notes.length === 0) continue;
    if (nFiles === 0 && score < 40) continue;
    results.push({
      id: plugin.id,
      name: plugin.name,
      score,
      files: nFiles,
      evidence: notes.length ? `${notes.join(", ")} · ${nFiles} files` : `${nFiles} files`,
      plugin,
    });
  }
  results.sort((a, b) => b.score - a.score);
  if (results.length === 0) {
    throw new Error(
      `No language matched in ${path.basename(projectRoot)}. Plugins: ${plugins.map((p) => p.name).join(", ")}`
    );
  }
  return results;
}

function walk(dir, onFile) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, onFile);
    else onFile(p);
  }
}
