import fs from "fs";
import path from "path";
import { discoverProjects } from "./projects.mjs";

const cache = new Map();

function graphFor(root) {
  const key = fs.realpathSync(root);
  if (!cache.has(key)) cache.set(key, discoverProjects(key));
  return cache.get(key);
}

/** Place every symbol under the same island tree prism projects uses. */
export function stampContext(outPath, root) {
  if (!fs.existsSync(outPath)) return;
  const doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const graph = graphFor(root);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const structural = graph.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    flavor: n.flavor,
    location: n.location,
    parents: n.parents || [],
    calls: (n.calls || []).map((c) => c.target),
  }));
  const targetNodes = [];
  for (const n of graph.nodes) {
    if (n.flavor !== "xcode") continue;
    for (const target of n.targets || []) {
      targetNodes.push({
        id: `${n.id}::target::${target}`,
        name: target,
        flavor: "xcode-target",
        location: n.location,
        parents: [n.id],
        calls: [],
      });
    }
  }

  const symbols = [];
  const symbolById = new Map();
  const files = doc.files || [];
  const nameIndex = new Map();
  const looseParents = new Map(); // lang → ungrouped::lang node
  for (const file of files) {
    const abs = file.path;
    const scope = scopeFor(graph, byId, abs);
    file.target = scope.archipelago;
    if (scope.loose) {
      if (!looseParents.has(scope.lang)) {
        const id = `ungrouped::${scope.lang}`;
        looseParents.set(scope.lang, {
          id,
          name: `ungrouped · ${scope.lang}`,
          flavor: "ungrouped",
          location: { absPath: root, line: 1 },
          parents: [],
          calls: [],
        });
      }
    }
    const fileId = `file::${scope.parentId}::${path.basename(abs)}`;
    symbols.push({
      id: fileId,
      name: path.basename(abs),
      flavor: "file",
      location: { absPath: abs, line: 1 },
      parents: [scope.parentId],
      calls: [],
    });
    for (const sig of file.signatures || []) {
      const id = `${fileId}::${sig.id}`;
      const flavor = flavorOf(sig.signature || sig.id);
      const symbol = {
        id,
        name: String(sig.id).split(".").pop(),
        flavor,
        location: { absPath: abs, line: sig.line || 1 },
        parents: [fileId],
        calls: [],
      };
      symbols.push(symbol);
      symbolById.set(id, symbol);
      sig.island = scope.archipelago;
      sig.loose = !!scope.loose;
      sig.nodeId = id;
      // Only index non-loose symbols for cross-file calls inside a real archipelago.
      if (!scope.loose) {
        const key = `${scope.archipelago}::${String(sig.id).split(".").pop()}`;
        if (!nameIndex.has(key)) nameIndex.set(key, id);
      }
    }
  }
  for (const file of files) {
    const scope = scopeFor(graph, byId, file.path);
    if (scope.loose) continue; // ungrouped piles stay unwired
    for (const sig of file.signatures || []) {
      const node = symbolById.get(sig.nodeId);
      if (!node) continue;
      for (const dep of sig.dependencies || []) {
        const hit = nameIndex.get(`${scope.archipelago}::${dep}`);
        if (hit && hit !== node.id) node.calls.push(hit);
      }
    }
  }

  doc.schemaVersion = "4.0-flat-graph";
  doc.nodes = [...structural, ...targetNodes, ...looseParents.values(), ...symbols];
  fs.writeFileSync(outPath, JSON.stringify(doc));
}

const LOOSE_SEGMENTS = new Set([
  "integration", "integrations", "examples", "example", "samples", "sample",
  "fixtures", "testdata", "playgrounds", "playground", "snippets",
]);

const EXT_LANG = {
  marlin: "marlin", marlinheader: "marlin",
  swift: "swift", m: "objc", mm: "objc",
  c: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", h: "cpp", hpp: "cpp",
  kt: "kotlin", kts: "kotlin",
  js: "js", jsx: "js", ts: "js", tsx: "js", mjs: "js", cjs: "js",
  rs: "rust", go: "go",
};

function langFromPath(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_LANG[ext] || "unknown";
}

function isLoosePath(filePath) {
  return filePath.split(path.sep).some((p) => LOOSE_SEGMENTS.has(String(p).toLowerCase()));
}

function scopeFor(graph, byId, filePath) {
  try { filePath = fs.realpathSync(filePath); } catch { /* keep */ }
  const lang = langFromPath(filePath);
  if (isLoosePath(filePath)) {
    return { archipelago: `ungrouped/${lang}`, parentId: `ungrouped::${lang}`, loose: true, lang };
  }
  const leaf = graph.nodes
    .filter((n) => n.location?.absPath && (filePath === n.location.absPath || filePath.startsWith(n.location.absPath + path.sep)))
    .sort((a, b) => {
      const d = b.location.absPath.length - a.location.absPath.length;
      if (d) return d;
      const rank = (n) => (n.flavor === "group" ? 0 : n.flavor === "xcode" ? 3 : 2);
      return rank(b) - rank(a);
    })[0];
  if (!leaf) {
    return { archipelago: `ungrouped/${lang}`, parentId: `ungrouped::${lang}`, loose: true, lang };
  }
  if (leaf.flavor === "group") {
    const tighter = graph.nodes.some(
      (n) =>
        n.flavor !== "group" &&
        n.location?.absPath &&
        (filePath === n.location.absPath || filePath.startsWith(n.location.absPath + path.sep))
    );
    if (!tighter) {
      return { archipelago: `ungrouped/${lang}`, parentId: `ungrouped::${lang}`, loose: true, lang };
    }
  }
  const parts = new Set(filePath.split(path.sep));
  if (leaf.flavor === "xcode") {
    const target = (leaf.targets || []).find((t) => parts.has(t));
    if (target) return { archipelago: `${leaf.name}/${target}`, parentId: `${leaf.id}::target::${target}`, loose: false, lang };
  }
  return { archipelago: leaf.name, parentId: leaf.id, loose: false, lang };
}

function flavorOf(signature) {
  const s = signature.toLowerCase();
  if (/\b(fn|func|function)\b/.test(s)) return "function";
  if (/\bstruct\b/.test(s)) return "struct";
  if (/\benum\b/.test(s)) return "enum";
  if (/\b(class|actor)\b/.test(s)) return "class";
  if (/\b(trait|protocol|interface)\b/.test(s)) return "protocol";
  if (/\b(let|var|const|static)\b/.test(s)) return "variable";
  return "symbol";
}
