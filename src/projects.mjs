import fs from "fs";
import path from "path";

const SKIP = new Set([
  ".build", "DerivedData", "Pods", "node_modules", ".git", "Carthage",
  "dist", "target", ".next", ".turbo", "__pycache__", ".venv", "vendor",
  ".cache", "CMakeFiles", "out", "build", "Generated", "generated",
  "xcuserdata", ".swiftpm",
]);

/**
 * Discover project roots under `root` and the edges between them.
 * Manifest-driven: Cargo, SPM, Xcode, npm/pnpm, Go, Gradle.
 * A remote URL still links when its repo name or Swift product name
 * matches a project that actually sits under this root.
 */
export function discoverProjects(root) {
  const realRoot = fs.realpathSync(root);
  const files = collect(realRoot);
  const projects = [];
  const byDir = new Map();

  const add = (project) => {
    projects.push(project);
    const list = byDir.get(project.root) || [];
    list.push(project);
    byDir.set(project.root, list);
    return project;
  };

  for (const file of files.cargo) parseCargo(file, add);
  for (const file of files.spm) parseSpm(file, add);
  for (const file of files.xcode) parseXcode(file, realRoot, add);
  for (const file of files.npm) parseNpm(file, add);
  for (const file of files.go) parseGo(file, add);
  for (const file of files.gradle) parseGradle(file, add);

  const edges = [];
  const seen = new Set();
  const link = (from, to, kind, via) => {
    if (!from || !to || from.root === to.root) return;
    const id = `${from.id}|${kind}|${to.id}|${via}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({
      from: from.id,
      to: to.id,
      kind,
      via,
    });
  };

  const findByRoot = (dir, ecosystem) => {
    const list = byDir.get(path.resolve(dir)) || [];
    if (ecosystem) {
      const hit = list.find((p) => p.ecosystem === ecosystem);
      if (hit) return hit;
    }
    return list[0];
  };
  const cargoByName = index(projects, (p) => p.ecosystem === "cargo" && p.name);
  const spmByName = index(projects, (p) => p.ecosystem === "spm" && p.name);
  const spmByDirName = new Map();
  for (const p of projects) {
    if (p.ecosystem === "spm" || p.ecosystem === "cargo" || p.ecosystem === "xcode") {
      spmByDirName.set(path.basename(p.root), p);
    }
  }

  for (const p of projects) {
    const childEco = p.ecosystem === "npm" ? "npm" : p.ecosystem === "gradle" ? "gradle" : "cargo";
    for (const member of p.members || []) {
      const child = findByRoot(member, childEco);
      if (child) link(p, child, "contains", "workspace member");
    }
    const depEco = p.ecosystem === "xcode" ? "spm" : p.ecosystem;
    for (const dep of p.pathDeps || []) {
      const target = resolveDep(p, dep.path, (dir) => findByRoot(dir, depEco));
      if (target) link(p, target, "depends", dep.via);
    }
    for (const dep of p.workspacePathDeps || []) {
      const target = resolveDep(p, dep.path, (dir) => findByRoot(dir, "cargo"));
      if (!target) continue;
      link(p, target, "depends", dep.via);
      for (const member of p.members || []) {
        const child = findByRoot(member, "cargo");
        if (!child) continue;
        if (child.usesWorkspace?.has(dep.name)) link(child, target, "depends", `${dep.name}.workspace`);
      }
    }
    for (const name of p.ffiLibraries || []) {
      const cargo = cargoByName.get(name) || cargoByName.get(name.replace(/_/g, "-"));
      if (cargo) link(p, cargo, "ffi", name);
    }
    for (const spec of p.remoteDeps || []) {
      const local =
        spmByName.get(spec.product) ||
        spmByDirName.get(spec.repo) ||
        spmByName.get(spec.repo);
      if (local && local.root !== p.root) {
        link(p, local, "depends", spec.via);
      }
    }
  }

  projects.sort((a, b) => a.root.localeCompare(b.root) || a.ecosystem.localeCompare(b.ecosystem));
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return toNodeGraph(realRoot, projects, edges);
}

/** Hierarchical nodes: parents = larger project, calls = project invokes project. */
function toNodeGraph(realRoot, projects, edges) {
  const sep = path.sep;
  const rel = (abs) => {
    const r = path.relative(realRoot, abs);
    return r === "" ? "." : r.split(sep).join("/");
  };
  const ancestor = (project) => {
    let best = null;
    for (const other of projects) {
      if (other === project || other.root === project.root) continue;
      if (!project.root.startsWith(other.root + sep)) continue;
      if (!best || other.root.length > best.root.length) best = other;
      else if (best && other.root.length === best.root.length && other.ecosystem === "xcode") best = other;
    }
    return best;
  };

  const groups = new Map();
  const ensureGroup = (dir) => {
    const key = path.resolve(dir);
    if (groups.has(key)) return groups.get(key);
    const node = {
      id: `group:${rel(key)}`,
      name: key === realRoot ? path.basename(realRoot) : path.basename(key),
      flavor: "group",
      location: { absPath: key },
      parents: [],
      calls: [],
    };
    groups.set(key, node);
    return node;
  };

  const directCount = new Map();
  for (const project of projects) {
    if (ancestor(project)) continue;
    const parentDir = path.dirname(project.root);
    if (!parentDir.startsWith(realRoot)) continue;
    directCount.set(parentDir, (directCount.get(parentDir) || 0) + 1);
  }
  if (projects.length) ensureGroup(realRoot);
  for (const [dir, count] of directCount) {
    if (count >= 2 && dir !== realRoot) ensureGroup(dir);
  }
  for (const [dir, node] of groups) {
    if (dir === realRoot) continue;
    let parentDir = path.dirname(dir);
    while (parentDir.startsWith(realRoot) && !groups.has(parentDir)) parentDir = path.dirname(parentDir);
    if (groups.has(parentDir) && parentDir !== dir) node.parents = [groups.get(parentDir).id];
  }

  const nodeByOld = new Map();
  const nodes = [...groups.values()];
  for (const project of projects) {
    const node = {
      id: `${project.ecosystem}:${rel(project.root)}`,
      name: project.name,
      flavor: project.ecosystem,
      location: { absPath: project.root },
      parents: [],
      calls: [],
      targets: project.targets || [],
    };
    const parentProject = ancestor(project);
    if (parentProject) node.parents = [`${parentProject.ecosystem}:${rel(parentProject.root)}`];
    else {
      const parentDir = path.dirname(project.root);
      const group = groups.get(parentDir) || groups.get(realRoot);
      if (group && group.location.absPath !== project.root) node.parents = [group.id];
    }
    nodeByOld.set(project.id, node);
    nodes.push(node);
  }

  for (const edge of edges) {
    if (edge.kind === "contains") continue;
    const from = nodeByOld.get(edge.from);
    const to = nodeByOld.get(edge.to);
    if (!from || !to || from.id === to.id) continue;
    if (from.calls.some((c) => c.target === to.id && c.kind === edge.kind && c.via === edge.via)) continue;
    from.calls.push({ target: to.id, kind: edge.kind, via: edge.via });
  }

  nodes.sort((a, b) => a.location.absPath.localeCompare(b.location.absPath) || a.id.localeCompare(b.id));
  return {
    schemaVersion: "4.0-flat-graph",
    projectRoot: realRoot,
    nodes,
  };
}

function index(projects, pick) {
  const map = new Map();
  for (const p of projects) {
    const name = pick(p);
    if (name && !map.has(name)) map.set(name, p);
  }
  return map;
}

function resolveDep(project, rel, findByRoot) {
  const abs = path.resolve(project.root, rel);
  return findByRoot(abs) || findByRoot(path.join(abs));
}

function collect(root) {
  const files = { cargo: [], spm: [], xcode: [], npm: [], go: [], gradle: [] };
  const seen = new Set();
  const walk = (dir) => {
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const p = path.join(dir, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace")) {
          files.xcode.push(p);
          continue;
        }
        walk(p);
      } else if (name === "Cargo.toml") files.cargo.push(p);
      else if (name === "Package.swift") files.spm.push(p);
      else if (name === "package.json") files.npm.push(p);
      else if (name === "go.mod") files.go.push(p);
      else if (name === "settings.gradle" || name === "settings.gradle.kts") files.gradle.push(p);
    }
  };
  walk(root);
  return files;
}

function parseCargo(file, add) {
  const text = read(file);
  if (!text) return;
  const dir = path.dirname(file);
  const sections = splitToml(text);
  const pkg = sections.get("package");
  const ws = sections.get("workspace");
  const name = pkg ? tomlString(pkg, "name") : null;
  const members = ws ? expandMembers(dir, tomlStringArray(ws, "members")) : [];
  const usesWorkspace = new Set();
  if (name) {
    const body = [...sections.entries()]
      .filter(([k]) => k === "dependencies" || k.endsWith(".dependencies"))
      .map(([, v]) => v)
      .join("\n");
    for (const match of body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*(?:\.workspace\s*=\s*true|=\s*\{\s*workspace\s*=\s*true)/gm)) {
      usesWorkspace.add(match[1]);
    }
  }
  const ffi = [];
  const uniffi = path.join(dir, "uniffi.toml");
  if (fs.existsSync(uniffi)) {
    const cdylib = tomlString(read(uniffi) || "", "cdylib_name");
    if (cdylib) ffi.push(cdylib);
    if (name) ffi.push(name.replace(/-/g, "_"));
  }
  const project = add({
    id: `cargo:${dir}`,
    name: name || path.basename(dir),
    ecosystem: "cargo",
    root: dir,
    manifest: file,
    members,
    pathDeps: pathDepsFrom(text, "manifest path"),
    workspacePathDeps: ws ? pathDepsFrom(sections.get("workspace.dependencies") || "", "workspace.dependencies") : [],
    usesWorkspace,
    ffiLibraries: ffi,
    remoteDeps: [],
  });
  project.members = members;
  project.pathDeps = pathDepsFrom(sections.get("dependencies") || "", "path");
  for (const key of ["dev-dependencies", "build-dependencies"]) {
    project.pathDeps.push(...pathDepsFrom(sections.get(key) || "", key));
  }
  project.workspacePathDeps = pathDepsFrom(sections.get("workspace.dependencies") || "", "workspace.dependencies");
}

function parseSpm(file, add) {
  const text = read(file);
  if (!text) return;
  const dir = path.dirname(file);
  const name = text.match(/name:\s*"([^"]+)"/)?.[1] || path.basename(dir);
  const pathDeps = [...text.matchAll(/\.package\(\s*path:\s*"([^"]+)"/g)].map((m) => ({
    path: m[1],
    via: `package(path: ${m[1]})`,
    name: path.basename(m[1]),
  }));
  const ffiLibraries = new Set();
  for (const m of text.matchAll(/linkedLibrary\(\s*"([^"]+)"/g)) ffiLibraries.add(m[1]);
  for (const m of text.matchAll(/matrix_[a-z0-9_]+/g)) ffiLibraries.add(m[0]);
  add({
    id: `spm:${dir}`,
    name,
    ecosystem: "spm",
    root: dir,
    manifest: file,
    members: [],
    pathDeps,
    workspacePathDeps: [],
    usesWorkspace: new Set(),
    ffiLibraries: [...ffiLibraries],
    remoteDeps: [],
  });
}

function parseXcode(dir, scanRoot, add) {
  const pbx = fs.existsSync(path.join(dir, "project.pbxproj"))
    ? path.join(dir, "project.pbxproj")
    : null;
  const text = pbx ? read(pbx) : "";
  const name = path.basename(dir);
  const root = path.dirname(dir);
  const targets = nativeTargets(text);
  const pathDeps = [];
  const remoteDeps = [];
  const ffiLibraries = new Set();
  if (text) {
    for (const m of text.matchAll(/relativePath = "([^"]+)";/g)) {
      pathDeps.push({ path: m[1], via: `XCLocalSwiftPackageReference ${m[1]}`, name: path.basename(m[1]) });
    }
    for (const m of text.matchAll(/repositoryURL = "([^"]+)";/g)) {
      const repo = repoName(m[1]);
      remoteDeps.push({ repo, product: repo, via: m[1] });
    }
    for (const m of text.matchAll(/productName = "?([A-Za-z0-9_]+)"?;/g)) {
      remoteDeps.push({ repo: m[1], product: m[1], via: `product ${m[1]}` });
    }
    for (const m of text.matchAll(/matrix_[a-z0-9_]+/g)) ffiLibraries.add(m[0]);
  }
  add({
    id: `xcode:${dir}`,
    name,
    ecosystem: "xcode",
    root,
    manifest: pbx || dir,
    members: [],
    pathDeps,
    workspacePathDeps: [],
    usesWorkspace: new Set(),
    ffiLibraries: [...ffiLibraries],
    remoteDeps,
    targets,
    scanRoot,
  });
}

function nativeTargets(text) {
  const section = text.split("/* Begin PBXNativeTarget section */")[1]?.split("/* End PBXNativeTarget section */")[0] || "";
  const names = [];
  for (const block of section.split("isa = PBXNativeTarget;").slice(1)) {
    const name = block.match(/\n\t\t\tname = "?([^";]+)"?;/)?.[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function parseNpm(file, add) {
  let json;
  try { json = JSON.parse(read(file) || ""); } catch { return; }
  const dir = path.dirname(file);
  const pathDeps = [];
  const members = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(json[field] || {})) {
      if (typeof spec === "string" && (spec.startsWith("file:") || spec.startsWith("link:"))) {
        pathDeps.push({ path: spec.replace(/^(file|link):/, ""), via: `${field}.${name}`, name });
      }
    }
  }
  const workspaces = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages || [];
  for (const pattern of workspaces) {
    for (const member of expandMembers(dir, [pattern])) {
      if (fs.existsSync(path.join(member, "package.json"))) members.push(member);
    }
  }
  add({
    id: `npm:${dir}`,
    name: json.name || path.basename(dir),
    ecosystem: "npm",
    root: dir,
    manifest: file,
    members,
    pathDeps,
    workspacePathDeps: [],
    usesWorkspace: new Set(),
    ffiLibraries: [],
    remoteDeps: [],
  });
}

function parseGo(file, add) {
  const text = read(file);
  if (!text) return;
  const dir = path.dirname(file);
  const name = text.match(/^module\s+(\S+)/m)?.[1] || path.basename(dir);
  const pathDeps = [...text.matchAll(/^\s*(\S+)\s+=>\s+(\.\/[^\s]+)/gm)].map((m) => ({
    path: m[2],
    via: `replace ${m[1]}`,
    name: m[1],
  }));
  add({
    id: `go:${dir}`,
    name,
    ecosystem: "go",
    root: dir,
    manifest: file,
    members: [],
    pathDeps,
    workspacePathDeps: [],
    usesWorkspace: new Set(),
    ffiLibraries: [],
    remoteDeps: [],
  });
}

function parseGradle(file, add) {
  const text = read(file);
  if (!text) return;
  const dir = path.dirname(file);
  const members = [];
  for (const m of text.matchAll(/include\(?\s*['"](:[^'"]+)['"]/g)) {
    const rel = m[1].replace(/:/g, "/").replace(/^\//, "");
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs)) members.push(abs);
  }
  add({
    id: `gradle:${dir}`,
    name: path.basename(dir),
    ecosystem: "gradle",
    root: dir,
    manifest: file,
    members,
    pathDeps: [],
    workspacePathDeps: [],
    usesWorkspace: new Set(),
    ffiLibraries: [],
    remoteDeps: [],
  });
}

function pathDepsFrom(text, via) {
  if (!text) return [];
  const deps = [];
  const re = /([A-Za-z0-9_-]+)\s*=\s*\{[^}\n]*path\s*=\s*"([^"]+)"/g;
  for (const m of text.matchAll(re)) deps.push({ name: m[1], path: m[2], via: `${via} ${m[1]}` });
  return deps;
}

function expandMembers(dir, patterns) {
  const out = [];
  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      out.push(path.resolve(dir, pattern));
      continue;
    }
    const [head, tail] = pattern.split("*");
    const base = path.resolve(dir, head);
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const candidate = path.join(base, e.name, tail || "");
      if (fs.existsSync(path.join(candidate, "Cargo.toml")) || fs.existsSync(path.join(candidate, "package.json"))) {
        out.push(candidate);
      }
    }
  }
  return out;
}

function splitToml(text) {
  const sections = new Map();
  let name = "";
  let buf = [];
  const flush = () => sections.set(name, buf.join("\n"));
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\[([^\]]+)\]/);
    if (header) {
      flush();
      name = header[1].replace(/"/g, "");
      buf = [];
    } else buf.push(line);
  }
  flush();
  return sections;
}

function tomlString(text, key) {
  return text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] || null;
}

function tomlStringArray(text, key) {
  const m = text.match(new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`, "s"));
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function repoName(url) {
  return url.replace(/\.git$/, "").split("/").filter(Boolean).pop() || url;
}

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}
