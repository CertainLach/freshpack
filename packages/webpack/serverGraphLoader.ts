import { type Loader, ResolutionMode } from "@deno/loader";
import { fromFileUrl, toFileUrl } from "@std/path";
import { ImportType, init, parse } from "es-module-lexer";
import type { LoaderContext } from "webpack";

export const ISLAND_QUERY = "?fresh-island";
export const SOURCE_HASH = "freshSourceHash";

export interface ServerGraph {
  loader: () => Promise<Loader>;
  css: boolean;
  follow: (path: string) => boolean;
  isIsland: (path: string) => boolean;
}

type Options = { id: number };
type Context = LoaderContext<Options>;

const registry = new Map<number, ServerGraph>();
let nextId = 0;

export function registerServerGraph(graph: ServerGraph): number {
  const id = nextId++;
  registry.set(id, graph);
  return id;
}

const JS_MODULE = /\.[cm]?[jt]sx?$/;

async function collectImports(
  graph: ServerGraph,
  resourcePath: string,
  source: string,
): Promise<string> {
  await init;
  let imports;
  try {
    [imports] = parse(source, resourcePath);
  } catch {
    return "export {};";
  }
  const loader = await graph.loader();
  const referrer = toFileUrl(resourcePath).href;
  const out: string[] = [];
  for (const { n: specifier, t, at } of imports) {
    if (t !== ImportType.Static || specifier === undefined) continue;
    const isCss = at?.some(([k, v]) => k === "type" && v === "css") ?? false;
    if (at !== null && !isCss) continue;

    let resolved: string;
    try {
      resolved = await loader.resolve(
        specifier,
        referrer,
        ResolutionMode.Import,
      );
    } catch {
      continue;
    }
    if (resolved.startsWith("file:")) {
      resolved = fromFileUrl(resolved);
    } else if (!isCss || !resolved.startsWith("https:")) {
      continue;
    }

    if (isCss || resolved.endsWith(".css")) {
      if (!graph.css) continue;
      out.push(
        isCss
          ? `import ${JSON.stringify(resolved)} with { type: "css" };`
          : `import ${JSON.stringify(resolved)};`,
      );
    } else if (JS_MODULE.test(resolved) && graph.follow(resolved)) {
      const request = graph.isIsland(resolved)
        ? resolved + ISLAND_QUERY
        : resolved;
      out.push(`import ${JSON.stringify(request)};`);
    }
  }
  out.push("export {};");
  return out.join("\n");
}

export default function serverGraphLoader(
  this: Context,
  source: string,
): void {
  const callback = this.async();
  if (this.resourceQuery === ISLAND_QUERY) {
    callback(null, "export {};");
    return;
  }
  const buildInfo = this._module?.buildInfo;
  if (buildInfo) {
    buildInfo[SOURCE_HASH] = this.utils.createHash().update(source).digest(
      "hex",
    );
  }
  const graph = registry.get(this.getOptions().id);
  if (!graph) {
    callback(
      new Error(`server graph ${this.getOptions().id} is not registered`),
    );
    return;
  }
  collectImports(graph, this.resourcePath, source).then(
    (code) => callback(null, code),
    (e) => callback(e),
  );
}
