import { type Loader, ResolutionMode } from "@deno/loader";
import { fromFileUrl, toFileUrl } from "@std/path";
import { ImportType, init, parse } from "es-module-lexer";
import type { LoaderContext } from "webpack";

export interface RouteCssGraph {
  loader: () => Promise<Loader>;
  follow: (path: string) => boolean;
}

type Options = { id: number };
type Context = LoaderContext<Options>;

const registry = new Map<number, RouteCssGraph>();
let nextId = 0;

export function registerRouteCssGraph(graph: RouteCssGraph): number {
  const id = nextId++;
  registry.set(id, graph);
  return id;
}

const JS_MODULE = /\.[cm]?[jt]sx?$/;

async function collectImports(
  graph: RouteCssGraph,
  resourcePath: string,
  source: string,
): Promise<string> {
  await init;
  const loader = await graph.loader();
  const referrer = toFileUrl(resourcePath).href;
  const [imports] = parse(source, resourcePath);
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

    if (isCss) {
      out.push(`import ${JSON.stringify(resolved)} with { type: "css" };`);
    } else if (resolved.endsWith(".css")) {
      out.push(`import ${JSON.stringify(resolved)};`);
    } else if (JS_MODULE.test(resolved) && graph.follow(resolved)) {
      out.push(`import ${JSON.stringify(resolved)};`);
    }
  }
  out.push("export {};");
  return out.join("\n");
}

export default function routeCssLoader(this: Context, source: string): void {
  const callback = this.async();
  const graph = registry.get(this.getOptions().id);
  if (!graph) {
    callback(
      new Error(`route css graph ${this.getOptions().id} is not registered`),
    );
    return;
  }
  collectImports(graph, this.resourcePath, source).then(
    (code) => callback(null, code),
    (e) => callback(e),
  );
}
