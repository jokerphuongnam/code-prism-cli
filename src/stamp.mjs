import fs from "fs";
import path from "path";
import { discoverProjects } from "./projects.mjs";

const cache = new Map();
const LOOSE_SEGMENTS = new Set([
  "integration", "integrations", "examples", "example", "samples", "sample",
  "fixtures", "testdata", "playgrounds", "playground", "snippets",
]);
const EXT_LANG = {
  marlin: "marlin", swift: "swift", m: "objc", mm: "objc",
  c: "cpp", cc: "cpp", cpp: "cpp", h: "cpp", hpp: "cpp",
  kt: "kotlin", kts: "kotlin", js: "js", jsx: "js", ts: "js", tsx: "js",
  mjs: "js", cjs: "js", rs: "rust", go: "go",
};

function graphFor(root) {
  const key = fs.realpathSync(root);
  if (!cache.has(key)) cache.set(key, discoverProjects(key));
  return cache.get(key);
}

/** Place every symbol under the project → archipelago → leaf tree. */
export function stampContext(outPath, root) {
  if (!fs.existsSync(outPath)) return;
  const doc = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const graph = graphFor(root);
  const tree = nestProject(graph, path.basename(graph.projectRoot || fs.realpathSync(root)));
  const boxes = indexBoxes(tree);
  const symbolById = new Map();
  const owners = new Map();
  const byName = new Map();
  const files = doc.files || [];
  for (const child of tree.nodes || []) {
    if ((child.flavor === "spm" || child.flavor === "npm") && child.location?.absPath) {
      child.name = path.basename(child.location.absPath);
    }
  }
  for (const file of files) {
    const abs = file.path;
    const scope = scopeFor(graph, abs);
    file.target = scope.archipelago;
    const parent = ensureParent(tree, boxes, scope, root);
    const top = scope.loose ? parent.name : topIsland(tree, scope.parentId);
    const fileNode = {
      id: `file::${scope.parentId}::${path.basename(abs)}`,
      name: path.basename(abs),
      kind: "archipelago",
      flavor: "file",
      location: { absPath: abs, line: 1 },
      nodes: [],
      calls: [],
    };
    parent.nodes.push(fileNode);
    for (const sig of file.signatures || []) {
      const id = `${fileNode.id}::${sig.id}`;
      const symbol = {
        id,
        name: String(sig.id).split(".").pop(),
        kind: "leaf",
        flavor: flavorOf(sig.signature || sig.id),
        location: { absPath: abs, line: sig.line || 1 },
        nodes: [],
        calls: [],
      };
      fileNode.nodes.push(symbol);
      symbolById.set(id, symbol);
      sig.nodeId = id;
      if (scope.loose) continue;
      owners.set(id, { top, archipelago: scope.archipelago });
      if (!byName.has(symbol.name)) byName.set(symbol.name, []);
      byName.get(symbol.name).push(id);
    }
  }
  for (const id of symbolById.keys()) {
    const node = symbolById.get(id);
    const mine = owners.get(id);
    if (!mine) continue;
    const sigDeps = [];
    for (const file of files) {
      for (const sig of file.signatures || []) {
        if (sig.nodeId === id) sigDeps.push(...(sig.dependencies || []));
      }
    }
    const seenDepends = new Set();
    for (const dep of sigDeps) {
      const hits = byName.get(dep) || [];
      const local = hits.find((hit) => owners.get(hit)?.archipelago === mine.archipelago && hit !== id);
      if (local) {
        node.calls.push({ target: local, kind: "call" });
        continue;
      }
      const remote = hits.find((hit) => owners.get(hit)?.top && owners.get(hit).top !== mine.top);
      const topName = remote ? owners.get(remote).top : null;
      if (topName && !seenDepends.has(topName)) {
        seenDepends.add(topName);
        node.calls.push({ target: `island:${topName}`, kind: "depends" });
      }
    }
  }

  doc.schemaVersion = "5.0-nested";
  doc.node = tree;
  doc.nodes = [tree];
  fs.writeFileSync(outPath, JSON.stringify(doc));
}

function ensureParent(tree, boxes, scope, root) {
  if (!scope.loose) return boxes.get(scope.parentId) || tree;
  let node = boxes.get(scope.parentId);
  if (node) return node;
  node = {
    id: scope.parentId,
    name: `ungrouped · ${scope.lang}`,
    kind: "archipelago",
    flavor: "ungrouped",
    location: { absPath: root },
    nodes: [],
    calls: [],
  };
  tree.nodes.push(node);
  boxes.set(node.id, node);
  return node;
}

function nestProject(graph, projectName) {
  const boxes = new Map();
  const box = (n, kind) => ({
    id: n.id,
    name: n.name,
    kind,
    flavor: n.flavor,
    location: n.location,
    nodes: [],
    calls: (n.calls || []).map((c) => ({ target: c.target, kind: c.kind || "depends" })),
  });
  for (const n of graph.nodes) {
    const kind = n.flavor === "group" && !(n.parents || []).length ? "project" : "archipelago";
    boxes.set(n.id, box(n, kind));
  }
  for (const n of graph.nodes) {
    if (n.flavor !== "xcode") continue;
    for (const target of n.targets || []) {
      const id = `${n.id}::target::${target}`;
      boxes.set(id, {
        id, name: target, kind: "archipelago", flavor: "xcode-target",
        location: n.location, nodes: [], calls: [],
      });
      boxes.get(n.id).nodes.push(boxes.get(id));
    }
  }
  const roots = [];
  for (const n of graph.nodes) {
    const parentId = (n.parents || [])[0];
    const parent = parentId && boxes.get(parentId);
    if (parent) parent.nodes.push(boxes.get(n.id));
    else roots.push(boxes.get(n.id));
  }
  liftPackagesBesideXcode(roots);
  const project = roots.length === 1 && roots[0].kind === "project"
    ? roots[0]
    : { id: `project:${projectName}`, name: projectName, kind: "project", flavor: "project", nodes: roots, calls: [] };
  project.kind = "project";
  project.name = project.name || projectName;
  clusterAppFolders(project);
  return project;
}

function clusterAppFolders(project) {
  const xcodes = (project.nodes || []).filter((n) => n.flavor === "xcode");
  if (!xcodes.length) return;
  const xcodeDirs = new Set(xcodes.map((n) => n.location?.absPath).filter(Boolean));
  const consumed = new Set();
  const apps = [];
  for (const xcode of xcodes) {
    const dir = xcode.location?.absPath;
    if (!dir) continue;
    const members = project.nodes.filter((n) => {
      const loc = n.location?.absPath || "";
      if (n === xcode) return true;
      if (n.flavor === "spm" && loc === dir) return false;
      return loc.startsWith(dir + path.sep);
    });
    apps.push({
      id: `app:${dir}`,
      name: xcode.name.replace(/\.xcodeproj$/, "").replace(/\.xcworkspace$/, ""),
      kind: "archipelago",
      flavor: "app",
      location: { absPath: dir },
      nodes: members,
      calls: [],
    });
    for (const member of members) consumed.add(member.id);
  }
  project.nodes = [
    ...apps,
    ...project.nodes.filter((n) => !consumed.has(n.id) && !(n.flavor === "spm" && xcodeDirs.has(n.location?.absPath))),
  ];
}

function liftPackagesBesideXcode(nodes) {
  for (const node of nodes) {
    liftPackagesBesideXcode(node.nodes);
    if (node.flavor !== "xcode") continue;
    const packages = node.nodes.filter((n) => n.flavor === "spm");
    node.nodes = node.nodes.filter((n) => n.flavor !== "spm");
    const host = nodes.find((n) => n.nodes && n.nodes.includes(node)) || null;
    const dest = host ? host.nodes : nodes;
    for (const pkg of packages) {
      if (!dest.includes(pkg)) dest.push(pkg);
    }
  }
}

function topIsland(tree, parentId) {
  for (const child of tree.nodes || []) {
    if (child.id === parentId || containsId(child, parentId)) return child.name;
  }
  return tree.name;
}

function containsId(node, id) {
  for (const child of node.nodes || []) {
    if (child.id === id || containsId(child, id)) return true;
  }
  return false;
}

function indexBoxes(node, map = new Map()) {
  map.set(node.id, node);
  for (const child of node.nodes || []) indexBoxes(child, map);
  return map;
}

function real(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

function langFromPath(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return EXT_LANG[ext] || "unknown";
}

function isLoosePath(filePath) {
  return filePath.split(path.sep).some((p) => LOOSE_SEGMENTS.has(String(p).toLowerCase()));
}

function scopeFor(graph, filePath) {
  filePath = real(filePath);
  const lang = langFromPath(filePath);
  if (isLoosePath(filePath)) {
    return { archipelago: `ungrouped/${lang}`, parentId: `ungrouped::${lang}`, loose: true, lang };
  }
  const leaf = graph.nodes
    .filter((n) => {
      const root = n.location?.absPath ? real(n.location.absPath) : "";
      return root && (filePath === root || filePath.startsWith(root + path.sep));
    })
    .sort((a, b) => {
      const d = b.location.absPath.length - a.location.absPath.length;
      if (d) return d;
      const rank = (n) => (n.flavor === "group" ? 0 : n.flavor === "xcode" ? 3 : 2);
      return rank(b) - rank(a);
    })[0];
  if (!leaf || leaf.flavor === "group") {
    return { archipelago: `ungrouped/${lang}`, parentId: `ungrouped::${lang}`, loose: true, lang };
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
