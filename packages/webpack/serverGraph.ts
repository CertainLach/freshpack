import { dirname, join } from "@std/path";

export type GraphPattern = string | RegExp;

export interface GraphOptions {
  include?: GraphPattern[];
  exclude?: GraphPattern[];
}

interface PackageInfo {
  root: string;
  name: string | undefined;
}

function readPackageJson(dir: string): { name?: unknown } | null {
  try {
    return JSON.parse(Deno.readTextFileSync(join(dir, "package.json")));
  } catch {
    return null;
  }
}

class PackageLookup {
  #cache = new Map<string, PackageInfo | null>();

  find(path: string): PackageInfo | null {
    const visited: string[] = [];
    let dir = dirname(path);
    let found: PackageInfo | null = null;
    for (;;) {
      const cached = this.#cache.get(dir);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      visited.push(dir);
      const pkg = readPackageJson(dir);
      if (pkg !== null) {
        found = {
          root: dir,
          name: typeof pkg.name === "string" ? pkg.name : undefined,
        };
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    for (const dir of visited) this.#cache.set(dir, found);
    return found;
  }
}

function matchesPackage(pattern: string, name: string | undefined): boolean {
  if (name === undefined) return false;
  return pattern.endsWith("/*")
    ? name.startsWith(pattern.slice(0, -1))
    : name === pattern;
}

const ISLAND_SEGMENTS = new Set(["islands", "(_islands)"]);

export class ServerGraphRules {
  #packages = new PackageLookup();
  #root: string;

  constructor(
    root: string,
    public options: GraphOptions = {},
    public islandFiles: Set<string> = new Set(),
  ) {
    this.#root = root.endsWith("/") ? root : root + "/";
  }

  reset(islandFiles: Set<string>) {
    this.#packages = new PackageLookup();
    this.islandFiles = islandFiles;
  }

  #isLocal(path: string): boolean {
    return path.startsWith(this.#root) &&
      !path.slice(this.#root.length).split("/").includes("node_modules");
  }

  #matches(patterns: GraphPattern[], path: string): boolean {
    const name = this.#packages.find(path)?.name;
    return patterns.some((pattern) =>
      pattern instanceof RegExp
        ? pattern.test(path)
        : matchesPackage(pattern, name)
    );
  }

  follow(path: string): boolean {
    const { include, exclude } = this.options;
    if (exclude !== undefined && this.#matches(exclude, path)) return false;
    if (this.#isLocal(path)) return true;
    return include === undefined || this.#matches(include, path);
  }

  isIsland(path: string): boolean {
    if (this.islandFiles.has(path)) return true;
    let base: string | undefined;
    if (this.#isLocal(path)) base = this.#root;
    const pkg = this.#packages.find(path);
    if (
      pkg !== null && (base === undefined || pkg.root.length >= base.length)
    ) {
      base = pkg.root + "/";
    }
    if (base === undefined) return false;
    const segments = path.slice(base.length).split("/").slice(0, -1);
    return segments.some((segment) => ISLAND_SEGMENTS.has(segment));
  }
}
