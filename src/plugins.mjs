import fs from "fs";
import os from "os";
import path from "path";

export function backendsCheckoutRoot() {
  return path.join(os.homedir(), "Documents", "Code", "code-prism", "backends");
}

export function installedRoot() {
  return path.join(os.homedir(), "Library", "Application Support", "CodePrism", "backends");
}

export function cacheRoot() {
  return path.join(os.homedir(), "Library", "Caches", "code-prism");
}

function tryLoad(dir) {
  const manifestPath = path.join(dir, "code-prism-plugin.json");
  if (!fs.existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }
  const cacheFolder =
    manifest.cacheFolder ||
    (manifest.id === "objc" ? "objective-c-prism" : `${manifest.id}-prism`);
  const candidates = [
    path.join(dir, "bin", manifest.bin),
    path.join(dir, manifest.bin),
    path.join(dir, "core", ".build", "release", manifest.bin),
    path.join(installedRoot(), manifest.id, manifest.bin),
  ];
  const binaryPath =
    candidates.find((p) => {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) || candidates.find((p) => fs.existsSync(p));

  return {
    id: manifest.id,
    name: manifest.name,
    bin: manifest.bin,
    extensions: (manifest.extensions || []).map((e) => e.toLowerCase()),
    markers: manifest.markers || [],
    cacheFolder,
    version: manifest.version || "0",
    root: dir,
    binaryPath: binaryPath || null,
  };
}

/** True if this plugin can claim source files (manifest extensions and/or markers). */
export function canDetectLanguage(plugin) {
  return (plugin.extensions?.length ?? 0) > 0 || (plugin.markers?.length ?? 0) > 0;
}

/** Discover plugins from Application Support + backends checkouts. */
export function discoverPlugins() {
  const byId = new Map();

  const scan = (root) => {
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const plugin = tryLoad(dir);
      if (!plugin) continue;
      const existing = byId.get(plugin.id);
      if (!existing || (plugin.binaryPath && !existing.binaryPath)) {
        byId.set(plugin.id, plugin);
      }
    }
  };

  scan(installedRoot());
  scan(backendsCheckoutRoot());
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function findPlugin(idOrName) {
  const q = String(idOrName).toLowerCase().replace(/-prism$/, "");
  return discoverPlugins().find(
    (p) =>
      p.id === q ||
      p.id === idOrName ||
      p.name.toLowerCase() === q ||
      p.cacheFolder === idOrName ||
      p.cacheFolder === `${q}-prism`
  );
}
