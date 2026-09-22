import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { attachSymbolIslands } from "./symbols.mjs";

/** Write a self-contained island map and open it. */
export function openProjectUI(graph, root, opts = {}) {
  const file = path.join(os.tmpdir(), `prism-islands-${Date.now()}.html`);
  fs.writeFileSync(file, render(attachSymbolIslands(graph), root));
  if (opts.open !== false) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [file], { detached: true, stdio: "ignore" }).unref();
  }
  return file;
}

function render(graph, root) {
  const data = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<title>Prism — ${path.basename(root)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #12141a; color: #e8e6e3; font: 13px/1.3 ui-sans-serif, system-ui; }
  header { display: flex; gap: 18px; align-items: center; padding: 12px 16px; position: sticky; top: 0; background: #12141abf; flex-wrap: wrap; }
  .swatch { width: 28px; height: 3px; display: inline-block; margin-right: 6px; vertical-align: middle; }
  #board { position: relative; overflow: auto; height: calc(100vh - 52px); }
  svg { position: absolute; inset: 0; pointer-events: none; }
  .regions { position: relative; display: flex; gap: 48px; padding: 24px; align-items: flex-start; }
  .region { border-radius: 22px; padding: 14px; background: #1a1d27; border: 1px solid #3a4154; }
  .region > h2 { margin: 0 0 10px; font-size: 15px; }
  .archipelagos { display: flex; gap: 16px; align-items: flex-start; }
  .archipelago { min-width: 180px; max-width: 240px; border-radius: 16px; padding: 10px; background: color-mix(in srgb, var(--tint) 16%, #141821); border: 1.5px solid var(--tint); }
  .archipelago h3 { margin: 0 0 8px; font-size: 13px; color: var(--tint); }
  .archipelago .archipelago { margin-top: 8px; }
  .node { margin: 4px 0; padding: 4px 8px; border-radius: 999px; background: #0e1016cc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  .symbol-islands { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 8px 8px; }
  .symbol-island { border: 1px dashed #3ec6ff; border-radius: 10px; padding: 4px; }
  .sym { font-size: 10px; opacity: 0.9; }
</style>
<header>
  <strong>Prism</strong>
  <span><i class="swatch" style="background:#3ec6ff"></i>Trong quần đảo</span>
  <span><i class="swatch" style="background:#c084fc"></i>Giữa các quần đảo</span>
  <span><i class="swatch" style="background:#ff9f43"></i>Giữa các đảo lớn</span>
</header>
<div id="board"></div>
<script>
const graph = ${data};
const nodes = graph.nodes;
const kids = (id) => nodes.filter(n => n.parents.includes(id)).sort((a,b) => a.name.localeCompare(b.name));
const root = nodes.find(n => n.flavor === "group" && n.parents.length === 0);
const regions = root ? kids(root.id) : nodes.filter(n => n.parents.length === 0);
const archipelagoOf = new Map();
const regionOf = new Map();
function tagTree(id, region, archipelago) {
  regionOf.set(id, region);
  archipelagoOf.set(id, archipelago);
  for (const n of kids(id)) tagTree(n.id, region, archipelago);
}
const tints = ["#2ec4b6","#7c6cff","#5cdb95","#60a5fa","#34d399","#f472b6"];
const board = document.getElementById("board");
const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
const wrap = document.createElement("div");
wrap.className = "regions";
board.append(svg, wrap);

function chip(node) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "node";
  row.textContent = node.name;
  row.dataset.id = node.id;
  wrap.append(row);
  const islands = node.symbolIslands || [];
  if (!islands.length) return wrap;
  const box = document.createElement("div");
  box.className = "symbol-islands";
  for (const isle of islands) {
    const g = document.createElement("div");
    g.className = "symbol-island";
    g.dataset.id = isle.id;
    for (const sym of isle.symbols) {
      const s = document.createElement("div");
      s.className = "node sym";
      s.textContent = sym.flavor + " " + sym.name;
      s.dataset.id = sym.id;
      g.append(s);
    }
    box.append(g);
  }
  wrap.append(box);
  return wrap;
}

const tops = root ? kids(root.id) : nodes.filter(n => n.parents.length === 0);
const clusters = [];
const byDir = new Map();
for (const n of tops) {
  if (n.flavor === "group") {
    clusters.push({ title: n.name, anchor: n, units: kids(n.id) });
    continue;
  }
  const dir = n.location.absPath;
  let cluster = byDir.get(dir);
  if (!cluster) {
    cluster = { title: dir.split("/").pop(), anchor: null, units: [] };
    byDir.set(dir, cluster);
    clusters.push(cluster);
  }
  cluster.units.push(n);
  if (n.flavor === "xcode") cluster.title = n.name.replace(/\\.(xcodeproj|xcworkspace)$/, "");
}

let tint = 0;
function addArchipelago(host, node, regionId) {
  const arch = document.createElement("div");
  arch.className = "archipelago";
  arch.style.setProperty("--tint", tints[tint++ % tints.length]);
  const h = document.createElement("h3");
  h.textContent = node.name;
  h.dataset.id = node.id;
  arch.append(h);
  regionOf.set(node.id, regionId);
  archipelagoOf.set(node.id, node.id);
  if (node.flavor === "xcode") {
    for (const target of node.targets || []) {
      const sub = document.createElement("div");
      sub.className = "archipelago";
      sub.style.setProperty("--tint", tints[tint++ % tints.length]);
      const sh = document.createElement("h3");
      sh.textContent = target;
      sub.append(sh);
      arch.append(sub);
    }
    host.append(arch);
    return;
  }
  const children = kids(node.id).filter(c => !(node.flavor === "xcode" && c.flavor === "spm"));
  const umbrella = children.length >= 2 && children.every(c => c.flavor === node.flavor);
  if (!umbrella) arch.append(chip(node));
  for (const child of children) {
    if (kids(child.id).length && child.flavor !== "spm") addArchipelago(arch, child, regionId);
    else if (child.flavor === "spm" || kids(child.id).length) addArchipelago(arch, child, regionId);
    else {
      arch.append(chip(child));
      tagTree(child.id, regionId, node.id);
    }
  }
  host.append(arch);
}

clusters.forEach((cluster) => {
  const box = document.createElement("section");
  box.className = "region";
  const title = document.createElement("h2");
  title.textContent = cluster.title;
  if (cluster.anchor) title.dataset.id = cluster.anchor.id;
  box.append(title);
  const row = document.createElement("div");
  row.className = "archipelagos";
  const regionId = cluster.anchor ? cluster.anchor.id : "dir:" + cluster.title;
  if (cluster.anchor) {
    regionOf.set(cluster.anchor.id, regionId);
    archipelagoOf.set(cluster.anchor.id, regionId);
  }
  let units = cluster.units.length ? cluster.units.slice() : (cluster.anchor ? [cluster.anchor] : []);
  const xcodes = units.filter(u => u.flavor === "xcode");
  if (xcodes.length) {
    units = units.filter(u => !(u.flavor === "spm" && xcodes.some(x => x.location.absPath === u.location.absPath)));
    const seen = new Set(units.map(u => u.id));
    const stack = xcodes.flatMap(x => kids(x.id));
    while (stack.length) {
      const n = stack.pop();
      if (n.flavor === "spm" && !seen.has(n.id)) { units.push(n); seen.add(n.id); }
      else stack.push(...kids(n.id));
    }
  }
  for (const unit of units) addArchipelago(row, unit, regionId);
  box.append(row);
  wrap.append(box);
});

function layout() {
  const boxes = new Map();
  const origin = wrap.getBoundingClientRect();
  board.querySelectorAll("[data-id]").forEach(el => {
    const r = el.getBoundingClientRect();
    boxes.set(el.dataset.id, { x: r.left - origin.left + board.scrollLeft, y: r.top - origin.top + board.scrollTop, w: r.width, h: r.height });
  });
  svg.setAttribute("width", wrap.scrollWidth);
  svg.setAttribute("height", wrap.scrollHeight);
  svg.style.width = wrap.scrollWidth + "px";
  svg.style.height = wrap.scrollHeight + "px";
  svg.innerHTML = "";
  const line = (a, b, color, width) => {
    const A = boxes.get(a), B = boxes.get(b);
    if (!A || !B) return;
    const p = document.createElementNS("http://www.w3.org/2000/svg","path");
    const x1 = A.x + A.w / 2, y1 = A.y + A.h, x2 = B.x + B.w / 2, y2 = B.y;
    p.setAttribute("d", "M"+x1+" "+y1+" C "+x1+" "+((y1+y2)/2)+", "+x2+" "+((y1+y2)/2)+", "+x2+" "+y2);
    p.setAttribute("fill","none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", String(width));
    svg.append(p);
  };
  for (const n of nodes) {
    for (const link of n.symbolLinks || []) line(link.from, link.to, "#3ec6ff", 1.2);
    for (const c of n.calls || []) {
      const sameArch = archipelagoOf.get(n.id) && archipelagoOf.get(n.id) === archipelagoOf.get(c.target);
      const sameRegion = regionOf.get(n.id) && regionOf.get(n.id) === regionOf.get(c.target);
      const color = sameArch ? "#3ec6ff" : sameRegion ? "#c084fc" : "#ff9f43";
      line(n.id, c.target, color, sameArch ? 1.2 : 2.2);
    }
  }
}
layout();
addEventListener("resize", layout);
</script>
`;
}
