import { assert } from "@std/assert";

export function stripFileUrl(u: string) {
  assert(u.startsWith("file://"), `not a file url: ${u}`);
  return u.slice(7);
}
export function resolveNpm(u: string) {
  const path = import.meta.resolve(`npm:${u}`);
  return stripFileUrl(path);
}

export function manglePath(path: string) {
  const tokens = path.replaceAll(/\\/g, "/").split(/([^a-zA-Z0-9_]+)/).filter((
    s,
  ) => s);

  return "_" + tokens.map((s) => {
    if (/^[a-zA-Z0-9_]+$/.test(s)) {
      return s.length + s;
    }
    return s.split("").map((c) => "_" + c.charCodeAt(0).toString(16)).join("");
  }).join("");
}

export function assertAbsolutePath(path: string) {
  // TODO: Windows
  assert(path.startsWith("/"), `path is not absolute: ${path}`);
}

export function ensureDirPath(path: string) {
  const stat = Deno.statSync(path);
  assert(stat.isDirectory, `path is not a directory: ${path}`);
  if (!path.endsWith("/")) path += "/";
  return path;
}
export function ensureModPath(path: string) {
  if (path.endsWith("/fakeMod.ts")) return path;
  if (!path.startsWith("https://")) {
    const stat = Deno.statSync(path);
    if (stat.isFile) return path;
    assert(stat.isDirectory, `path is not a directory: ${path}`);
  }
  if (path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".mjs")) {
    return path;
  }
  if (!path.endsWith("/")) path += "/fakeMod.ts";
  return path;
}
export function ensureFilePath(path: string) {
  const stat = Deno.statSync(path);
  assert(stat.isFile, `path is not a file: ${path}`);
  assert(!path.endsWith("/"), "file paths shouldn't end with /");
  return path;
}
export function assertResolved(path: string) {
  assert(path.startsWith("https://"), `path is not https: ${path}`);
}
export function ensureFileUrl(path: string) {
  return new URL(`file://${ensureFilePath(path)}`);
}
