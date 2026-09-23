import fs from "fs";
import path from "path";
import { projectSlug } from "./cache.mjs";
import { cacheRoot } from "./plugins.mjs";

/** Read schema 5 trees written by prism analyze. */
export function loadProjectTree(root) {
  const folder = path.join(cacheRoot(), projectSlug(root));
  if (!fs.existsSync(folder)) return null;
  const trees = [];
  for (const name of fs.readdirSync(folder)) {
    const file = path.join(folder, name, "prism-context.json");
    if (!fs.existsSync(file)) continue;
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const tree = doc.node || (Array.isArray(doc.nodes) && doc.nodes[0]?.nodes ? doc.nodes[0] : null);
    if (tree?.kind === "project") trees.push(tree);
  }
  if (!trees.length) return null;
  return mergeTrees(trees);
}

function mergeTrees(trees) {
  const base = structuredClone(trees[0]);
  const index = indexNodes(base);
  for (const extra of trees.slice(1)) {
    const walk = (node) => {
      const host = index.get(node.id);
      if (host && node.kind === "archipelago" && node.flavor === "file") {
        for (const child of node.nodes || []) {
          if (!host.nodes.some((n) => n.id === child.id)) host.nodes.push(child);
        }
      }
      for (const child of node.nodes || []) walk(child);
    };
    walk(extra);
  }
  return base;
}

function indexNodes(node, map = new Map()) {
  map.set(node.id, node);
  for (const child of node.nodes || []) indexNodes(child, map);
  return map;
}

void path;

export function summarizeTree(node) {
  const leaves = (node.nodes || []).filter((n) => n.kind === "leaf");
  const groups = (node.nodes || []).filter((n) => n.kind !== "leaf");
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    flavor: node.flavor,
    leaves: countLeaves(node),
    nodes: groups.map(summarizeTree),
  };
}

function countLeaves(node) {
  let n = node.kind === "leaf" ? 1 : 0;
  for (const child of node.nodes || []) n += countLeaves(child);
  return n;
}

void discoverPlugins;
