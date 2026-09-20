import crypto from "crypto";
import fs from "fs";
import path from "path";
import { cacheRoot } from "./plugins.mjs";

export function sanitizeProjectName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function projectHash(projectRoot) {
  const real = fs.realpathSync(projectRoot);
  return crypto.createHash("sha256").update(real).digest("hex").slice(0, 16);
}

export function projectSlug(projectRoot) {
  const real = fs.realpathSync(projectRoot);
  return `${sanitizeProjectName(path.basename(real))}-${projectHash(real)}`;
}

export function langPrismFolder(lang, cacheFolder) {
  if (cacheFolder) return cacheFolder;
  if (lang === "objc") return "objective-c-prism";
  if (String(lang).endsWith("-prism")) return lang;
  return `${lang}-prism`;
}

export function cacheDirFor(projectRoot, lang, cacheFolder) {
  return path.join(cacheRoot(), projectSlug(projectRoot), langPrismFolder(lang, cacheFolder));
}
