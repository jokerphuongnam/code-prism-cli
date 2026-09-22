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
  for (const file of files) {
    const abs = file.path;
    const scope = scopeFor(graph, byId, abs);
    file.target = scope.archipelago;
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
      sig.nodeId = id;
      const key = `${scope.archipelago}::${String(sig.id).split(".").pop()}`;
      if (!nameIndex.has(key)) nameIndex.set(key, id);
    }
  }
  for (const file of files) {
    const scope = scopeFor(graph, byId, file.path);
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
  doc.nodes = [...structural, ...targetNodes, ...symbols];
  fs.writeFileSync(outPath, JSON.stringify(doc));
}

function scopeFor(graph, byId, filePath) {
  try { filePath = fs.realpathSync(filePath); } catch { /* keep */ }
  const leaf = graph.nodes
    .filter((n) => n.location?.absPath && (filePath === n.location.absPath || filePath.startsWith(n.location.absPath + path.sep)))
    .sort((a, b) => {
      const d = b.location.absPath.length - a.location.absPath.length;
      if (d) return d;
      const rank = (n) => (n.flavor === "group" ? 0 : n.flavor === "xcode" ? 3 : 2);
      return rank(b) - rank(a);
    })[0];
  if (!leaf) return { archipelago: "root", parentId: graph.nodes.find((n) => n.flavor === "group" && !(n.parents || []).length)?.id || "root" };
  const parts = new Set(filePath.split(path.sep));
  if (leaf.flavor === "xcode") {
    const target = (leaf.targets || []).find((t) => parts.has(t));
    if (target) return { archipelago: `${leaf.name}/${target}`, parentId: `${leaf.id}::target::${target}` };
  }
  return { archipelago: leaf.name, parentId: leaf.id };
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
