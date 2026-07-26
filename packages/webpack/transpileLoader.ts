import { type Loader, RequestedModuleType } from "@deno/loader";
import { toFileUrl } from "@std/path";
import type { LoaderContext } from "webpack";

type Options = { id: number };
type Context = LoaderContext<Options>;
type SourceMap = Exclude<
  Parameters<Context["callback"]>[2],
  null | string | undefined
>;

const registry = new Map<number, () => Promise<Loader>>();
let nextId = 0;

export function registerDenoLoader(get: () => Promise<Loader>): number {
  const id = nextId++;
  registry.set(id, get);
  return id;
}

const INLINE_SOURCE_MAP =
  /\n?\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)[\t ]*$/;

function splitSourceMap(
  code: string,
): { code: string; map: SourceMap | undefined } {
  const match = INLINE_SOURCE_MAP.exec(code);
  if (!match) return { code, map: undefined };
  return {
    code: code.slice(0, match.index),
    map: JSON.parse(atob(match[1])) as SourceMap,
  };
}

export default function denoTranspileLoader(
  this: Context,
  _source: string,
): void {
  const callback = this.async();
  const { id } = this.getOptions();
  const get = registry.get(id);
  if (!get) {
    callback(new Error(`deno loader ${id} is not registered`));
    return;
  }
  const resourcePath = this.resourcePath;
  (async () => {
    const loader = await get();
    const specifier = toFileUrl(resourcePath).href;
    const loaded = await loader.load(specifier, RequestedModuleType.Default);
    if (loaded.kind !== "module") {
      throw new Error(`deno loader returned ${loaded.kind} for ${specifier}`);
    }
    return splitSourceMap(new TextDecoder().decode(loaded.code));
  })().then(
    ({ code, map }) => callback(null, code, map),
    (e) => callback(e),
  );
}
