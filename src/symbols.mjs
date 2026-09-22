import fs from "fs";
import path from "path";

const SKIP = new Set([
  ".build", "DerivedData", "Pods", "node_modules", ".git", "target",
  "dist", "build", "Generated", "generated", ".swiftpm",
]);

const EXTS = {
  cargo: ["rs"],
  spm: ["swift"],
  xcode: ["swift", "m", "mm"],
  npm: ["js", "jsx", "ts", "tsx", "mjs"],
  go: ["go"],
  gradle: ["kt", "kts", "java"],
};

const DECL = [
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/, "function"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z0-9_]+)/, "struct"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z0-9_]+)/, "enum"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z0-9_]+)/, "trait"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z0-9_]+)/, "type"],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z0-9_]+)/, "value"],
  [/^\s*(?:public|open|internal|private|fileprivate)?\s*(?:static\s+)?(?:func|init)\s+([A-Za-z0-9_]+)/, "function"],
  [/^\s*(?:public|open|internal)?\s*(?:struct|class|enum|protocol|actor)\s+([A-Za-z0-9_]+)/, "type"],
  [/^\s*(?:public|open)?\s*(?:var|let)\s+([A-Za-z0-9_]+)/, "value"],
  [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/, "function"],
  [/^\s*(?:export\s+)?class\s+([A-Za-z0-9_]+)/, "type"],
  [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/, "function"],
  [/^\s*type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/, "type"],
];

/**
 * Symbols inside one project, grouped into islands by who references whom.
 * Linked names share an island. Names with no link stay with their file.
 */
export function symbolIslands(projectRoot, flavor, blockedRoots) {
  const exts = EXTS[flavor];
  if (!exts) return [];
  const root = sourceRoot(projectRoot, flavor);
  const files = [];
  walk(root, exts, blockedRoots, files, 0);
  const symbols = [];
  const mentions = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const found = [];
    const seen = new Set();
    for (const line of text.split(/\r?\n/)) {
      for (const [re, kind] of DECL) {
        const m = line.match(re);
        if (!m || m[1] === "main") break;
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          found.push({ name: m[1], flavor: kind, file });
          break;
        }
      }
      if (found.length > 40) break;
    }
    const names = new Set();
    for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9_]{2,})\b/g)) names.add(m[1]);
    for (const m of text.matchAll(/\b([a-z][A-Za-z0-9_]{2,})\s*\(/g)) names.add(m[1]);
    const ids = [];
    for (const sym of found) {
      const id = `${flavor}:${path.relative(projectRoot, file)}:${sym.name}`;
      symbols.push({ id, name: sym.name, flavor: sym.flavor, file });
      ids.push(id);
    }
    mentions.push({ ids, names });
    if (symbols.length > 120) break;
  }
  if (!symbols.length) return [];

  const byFile = new Map();
  for (const sym of symbols) {
    if (!byFile.has(sym.file)) byFile.set(sym.file, []);
    byFile.get(sym.file).push(sym);
  }
  const islands = [...byFile.entries()].slice(0, 8).map(([file, group]) => ({
    id: `sym:${file}`,
    name: path.basename(file),
    symbols: group.slice(0, 10).map(({ id, name, flavor }) => ({ id, name, flavor })),
    defined: new Set(group.map((s) => s.name)),
  }));
  const links = [];
  for (const group of mentions) {
    const from = islands.find((isle) => isle.symbols.some((s) => group.ids.includes(s.id)));
    if (!from) continue;
    for (const isle of islands) {
      if (isle === from) continue;
      for (const name of isle.defined) {
        if (group.names.has(name)) {
          links.push({ from: from.id, to: isle.id });
          break;
        }
      }
    }
  }
  return islands.map(({ id, name, symbols }) => ({ id, name, symbols, links: links.filter((l) => l.from === id) }));
}

function sourceRoot(root, flavor) {
  if (flavor === "cargo" && fs.existsSync(path.join(root, "src"))) return path.join(root, "src");
  if ((flavor === "spm" || flavor === "xcode") && fs.existsSync(path.join(root, "Sources"))) {
    return path.join(root, "Sources");
  }
  return root;
}

function walk(dir, exts, blocked, out, depth) {
  if (out.length > 40 || depth > 6) return;
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (blocked.some((b) => p === b || p.startsWith(b + path.sep))) continue;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, exts, blocked, out, depth + 1);
    else if (exts.includes(path.extname(name).slice(1))) out.push(p);
  }
}

export function attachSymbolIslands(graph) {
  const roots = graph.nodes.map((n) => n.location?.absPath).filter(Boolean);
  const parents = new Set(graph.nodes.flatMap((n) => n.parents));
  for (const node of graph.nodes) {
    if (!node.location?.absPath || node.flavor === "group") continue;
    if (parents.has(node.id)) continue;
    const blocked = roots.filter((r) => r !== node.location.absPath && r.startsWith(node.location.absPath + path.sep));
    const islands = symbolIslands(node.location.absPath, node.flavor, blocked);
    node.symbolIslands = islands;
    node.symbolLinks = islands.flatMap((isle) => isle.links || []);
  }
  return graph;
}
