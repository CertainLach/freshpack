import {
  crawlFsItem,
  type FsRouteFileNoMod,
  TEST_FILE_PATTERN,
} from "@freshpack/core/internal-dev";
import Webpack from "webpack";
import { assertAbsolutePath, assertDirURL, manglePath } from "./util.ts";
import { assert } from "@std/assert";
import { IslandPreparer, ProdBuildCache } from "@freshpack/core/internal";
import {
  extname as extnamePosix,
  join as joinPosix,
  relative as relativePosix,
} from "@std/path/posix";
import { fromFileUrl } from "@std/path";
import { contentType as getStdContentType } from "@std/media-types/content-type";
import { encodeHex } from "@std/encoding";
import { UnmapPlugin } from "./unmap.ts";
import { type DenoEnvOptions, DenoEnvPlugin } from "./denoEnv.ts";
import { ViteIgnorePlugin } from "./viteComment.ts";
import { type RawImportsOptions, RawImportsPlugin } from "./rawImports.ts";
import { ImportMetaResolveAssetPlugin } from "./importMetaResolve.ts";
import { js, type JsRaw, toJsRaw } from "./quasiquote.ts";
import type { WorkspaceOptions } from "@deno/loader";
import { DenoLoaderPlugin, internalTranspileLoader } from "./resolve.ts";
import { defineRequire } from "./requireHook.ts";
import { registerRouteCssGraph } from "./routeCssLoader.ts";

const internalRouteCssLoader = defineRequire(
  "@freshpack/webpack/internal-route-css-loader",
  await import("./routeCssLoader.ts"),
);

const ROUTE_CSS_LAYER = "fresh-route-css";
const ROUTE_CSS_RUNTIME = "fresh-route-css-runtime";
const JS_MODULE = /\.[cm]?[jt]sx?$/;

interface WebpackFreshCompilation extends Webpack.Compilation {
  freshRoutes: FsRouteFileNoMod<unknown>[];
  freshIslands: { entryName: string; filePath: string }[];
  freshRouteCss: { entryName: string; filePath: string }[];
  freshRoot: string;
  buildId: string;

  prodBuildCache: ProdBuildCache<unknown>;
}

export function assertFreshCompilation(
  compilation: Webpack.Compilation,
): asserts compilation is WebpackFreshCompilation {
  assert(
    "freshRoutes" in compilation && "freshIslands" in compilation &&
      "freshRoot" in compilation,
    "missing fresh data in compilation, did you add WebpackFreshEntries plugin?",
  );
}

type CacheStaticFile = {
  name: string;
  filePath: string;
  contentType: string;
  hash: string;
  data: Uint8Array;
  size: number;
};

type ChunkFilter =
  | RegExp
  | "all"
  | "initial"
  | "async"
  | ((chunk: Webpack.Chunk) => boolean | undefined);

function excludeChunks(
  filter: ChunkFilter | undefined,
  excluded: (chunk: Webpack.Chunk) => boolean,
): (chunk: Webpack.Chunk) => boolean {
  return (chunk) => {
    if (excluded(chunk)) return false;
    if (filter === undefined || filter === "async") {
      return !chunk.canBeInitial();
    }
    if (filter === "initial") return chunk.canBeInitial();
    if (filter === "all") return true;
    if (filter instanceof RegExp) {
      return typeof chunk.name === "string" && filter.test(chunk.name);
    }
    return filter(chunk) ?? false;
  };
}

function isCssFile(file: string): boolean {
  return file.endsWith(".css");
}

function getMainChunkName(
  basePath: string,
  e: Webpack.Entrypoint,
): string {
  const file = [...e.getEntrypointChunk().files].find((v) =>
    v.endsWith(".mjs")
  );
  assert(file, `entrypoint ${e.name} has no javascript file`);
  return joinPosix(basePath, file);
}

function getCssFiles(basePath: string, e: Webpack.Entrypoint): string[] {
  return e.getFiles().filter(isCssFile).map((v) => joinPosix(basePath, v));
}
function getChunkFiles(
  basePath: string,
  e: Webpack.Entrypoint,
): string[] {
  return e.getFiles().map((v) => joinPosix(basePath, v));
}

export interface FreshPluginOptions {
  env?: DenoEnvOptions;
  rawImports?: RawImportsOptions;
  deno?: WorkspaceOptions;
  islandDir?: string | URL;
  routeDir?: string | URL;
  clientEntry?: string | URL;
  ignore?: RegExp[];
}

export class FreshPlugin {
  /**
   * @param baseUrl Location of fresh project root directory, you can specify it as `new URL('.', import.meta.url)` in build.ts
   * @param importHelper JSR dynamic file import workaround: You should pass `(path) => import(path)` here, where the function
   *                     should be defined anywhere outside of JSR published package. See this for details: https://github.com/denoland/deno/discussions/26266
   *                     This function will always be called with absolute path.
   */
  constructor(
    public baseUrl: URL,
    public importHelper: (path: string) => Promise<Record<string, unknown>>,
    public options: FreshPluginOptions = {},
  ) {
    assertDirURL(this.baseUrl);
    if (!importHelper) {
      console.warn(
        "[FreshPlugin]",
        "importHelper is not set, jsr release of @freshpack/webpack doesn't work without it: https://github.com/denoland/deno/discussions/26266#discussioncomment-12198284",
      );
      this.importHelper = (path: string) => import(path);
    }
  }
  resolvePath(path: string | URL): string {
    return fromFileUrl(new URL(path, this.baseUrl));
  }
  pathRelativeToBase(path: string) {
    return relativePosix(this.baseUrl.pathname, path);
  }
  #dist?: string;
  pathRelativeToDist(path: string) {
    assert(this.#dist, "dist path was not determined yet");
    return relativePosix(this.#dist, path);
  }
  #islandFiles = new Set<string>();

  applyDenoLoader(compiler: Webpack.Compiler): DenoLoaderPlugin {
    const existing = compiler.options.plugins.find((
      p,
    ): p is DenoLoaderPlugin => p instanceof DenoLoaderPlugin);
    if (existing) {
      assert(
        this.options.deno === undefined,
        "DenoLoaderPlugin is applied by FreshPlugin, remove it from plugins and pass its options as `deno` to FreshPlugin",
      );
      return existing;
    }
    const plugin = new DenoLoaderPlugin({ ...this.options.deno });
    plugin.apply(compiler);
    return plugin;
  }

  keepEntriesWhole(compiler: Webpack.Compiler, entries: Set<string>) {
    const splitChunks = compiler.options.optimization.splitChunks;
    if (!splitChunks || entries.size === 0) return;
    const excluded = (chunk: Webpack.Chunk) =>
      typeof chunk.name === "string" && entries.has(chunk.name);
    splitChunks.chunks = excludeChunks(splitChunks.chunks, excluded);
    for (const group of Object.values(splitChunks.cacheGroups ?? {})) {
      if (
        typeof group === "object" && !(group instanceof RegExp) &&
        group.chunks !== undefined
      ) {
        group.chunks = excludeChunks(group.chunks, excluded);
      }
    }
  }

  applyRouteCss(compiler: Webpack.Compiler, denoLoader: DenoLoaderPlugin) {
    compiler.options.module.rules.push({
      with: { type: "css" },
      type: "css",
      parser: { exportType: "link" },
    });

    const root = fromFileUrl(this.baseUrl);
    const graphId = registerRouteCssGraph({
      loader: () => denoLoader.loader,
      follow: (path) =>
        path.startsWith(root) && !path.includes("/node_modules/") &&
        !this.#islandFiles.has(path),
    });

    compiler.hooks.compilation.tap(
      FreshPlugin.name,
      (_compilation, { normalModuleFactory }) => {
        normalModuleFactory.hooks.afterResolve.tap(
          { name: FreshPlugin.name, stage: 100 },
          ({ createData: data }) => {
            if (data.layer !== ROUTE_CSS_LAYER) return;
            const resource = data.resource;
            if (
              resource === undefined || resource.includes("://") ||
              !JS_MODULE.test(resource)
            ) {
              return;
            }
            data.loaders = [
              {
                loader: internalRouteCssLoader,
                options: { id: graphId },
                ident: null,
                type: null,
              },
              ...(data.loaders ?? []).filter((v) =>
                v.loader === internalTranspileLoader
              ),
            ];
          },
        );
      },
    );
  }

  apply(compiler: Webpack.Compiler) {
    const denoLoader = this.applyDenoLoader(compiler);
    {
      // HACK: Webpack does not export EntryDependency, and it is impossible to use EntryPlugin, as
      // it wants to modify make stage, yet we have already reached this stage when we want to use
      // this plugin.
      //
      // Solvable by creating custom dependency plugin, or requiring user to manually specify
      // at least one entry... Or by registering EntryDependency manually as done here.
      const EntryDependency =
        Webpack.EntryPlugin.createDependency(`dummy`, {}).constructor;

      compiler.hooks.compilation.tap(
        FreshPlugin.name,
        (compilation, { normalModuleFactory }) => {
          compilation.dependencyFactories.set(
            EntryDependency as any,
            normalModuleFactory,
          );
        },
      );
    }

    (new UnmapPlugin()).apply(compiler);
    (new DenoEnvPlugin(this.options.env)).apply(compiler);
    (new ViteIgnorePlugin()).apply(compiler);
    (new RawImportsPlugin(this.options.rawImports)).apply(compiler);
    (new ImportMetaResolveAssetPlugin()).apply(compiler);
    // Some @std and other packages detect deno on presence of Deno global, dead-code-elimnate this stuff
    (new Webpack.DefinePlugin({ Deno: "undefined" })).apply(compiler);

    compiler.options.experiments.css ??= true;
    const routeCssEnabled = compiler.options.experiments.css === true;
    if (routeCssEnabled) this.applyRouteCss(compiler, denoLoader);

    const entryOption = compiler.options.entry;
    const userEntries = new Set(
      typeof entryOption === "function" ? [] : Object.keys(entryOption),
    );
    this.keepEntriesWhole(compiler, userEntries);

    compiler.hooks.make.tapPromise(
      FreshPlugin.name,
      async (_compilation: Webpack.Compilation) => {
        const compilation = _compilation as WebpackFreshCompilation;
        this.#dist = compilation.outputOptions.path;

        const compilationId = Date.now().toString(36);

        // Ensure hot chunks are resolved from correct path, they can't contain compilationId in name
        compilation.outputOptions.publicPath = "/";
        {
          // Chunks are content-addressed in prod, and have readable names using standard fresh cache pruning in dev
          if (compiler.options.mode === "production") {
            compilation.outputOptions.filename =
              `_fresh/js/c/[contenthash].mjs`;
            compilation.outputOptions.chunkFilename =
              `_fresh/js/c/[contenthash].mjs`;
            compilation.outputOptions.workerChunkFilename =
              `_fresh/js/c/[contenthash].mjs`;
            compilation.outputOptions.cssChunkFilename =
              `_fresh/js/c/[contenthash].css`;
          } else {
            compilation.outputOptions.filename =
              `_fresh/js/${compilationId}/[id].mjs`;
            compilation.outputOptions.chunkFilename =
              `_fresh/js/${compilationId}/[id].mjs`;
            compilation.outputOptions.workerChunkFilename =
              `_fresh/js/${compilationId}/[id].mjs`;
            compilation.outputOptions.cssChunkFilename =
              `_fresh/js/${compilationId}/[id].css`;
          }
          const cssChunkFilename = compilation.outputOptions.cssChunkFilename;
          compilation.outputOptions.cssFilename = (pathData) => {
            const name = pathData.chunk?.name;
            return typeof name === "string" && userEntries.has(name)
              ? "[name].css"
              : cssChunkFilename;
          };
          // Assets are always content-addressed
          compilation.outputOptions.assetModuleFilename =
            `_fresh/js/c/[hash][ext][query]`;
          compilation.outputOptions.webassemblyModuleFilename =
            `_fresh/js/c/[hash].wasm`;
        }

        compilation.hooks.processAssets.tapPromise(
          {
            name: FreshPlugin.name,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          },
          async (assets) => {
            compilation.getAssets();

            const cacheOut: JsRaw[] = [
              js`import{IslandPreparer,ProdBuildCache}from"@freshpack/core/internal"`,
              js`const islands=new Map()`,
              js`const islandPreparer=new IslandPreparer()`,
            ];

            const staticFiles = new Map<string, CacheStaticFile>();

            const routeEntrypoints = new Set<Webpack.ChunkGroup>();
            const routeCss = new Map<string, string[]>();
            for (const route of compilation.freshRouteCss) {
              const entrypoint = compilation.entrypoints.get(route.entryName);
              assert(
                entrypoint,
                `unable to find route css entrypoint: ${route.entryName}`,
              );
              routeEntrypoints.add(entrypoint);
              routeCss.set(route.filePath, getCssFiles(`/`, entrypoint));
            }
            for (const entrypoint of routeEntrypoints) {
              for (const chunk of entrypoint.chunks) {
                const routeOnly = [...chunk.groupsIterable].every((g) =>
                  routeEntrypoints.has(g)
                );
                if (!routeOnly) continue;
                const deleted = new Set<string>();
                for (const file of chunk.files) {
                  if (isCssFile(file)) continue;
                  deleted.add(file);
                }
                for (const file of chunk.auxiliaryFiles) {
                  if (deleted.has(file.replace(/\.map$/, ""))) {
                    deleted.add(file);
                  }
                }
                for (const file of deleted) {
                  if (compilation.getAsset(file)) compilation.deleteAsset(file);
                }
              }
            }

            const islands = new Map();
            const islandPreparer = new IslandPreparer();
            for (const island of compilation.freshIslands) {
              const entrypoint = compilation.entrypoints.get(island.entryName);
              assert(
                entrypoint,
                `unable to find island entrypoint: ${island.entryName}`,
              );
              const file = getMainChunkName(
                `/`,
                entrypoint,
              );
              const css = getCssFiles(`/`, entrypoint);

              islandPreparer.prepare(
                islands,
                await this.importHelper(island.filePath),
                file,
                island.entryName,
                css,
              );
              const importPath = this.pathRelativeToDist(island.filePath);
              cacheOut.push(
                js`islandPreparer.prepare(islands,await import(${importPath}),${file},${island.entryName},${css})`,
              );
            }

            const fsRoutesOut: JsRaw[] = [];
            const fsRoutes = await Promise.all(
              compilation.freshRoutes.map(async (v) => {
                const importPath = this.pathRelativeToDist(v.filePath);
                const css = routeCss.get(v.filePath) ?? [];
                fsRoutesOut.push(toJsRaw({
                  id: v.id,
                  mod: v.lazy
                    ? js`()=>import(${importPath})`
                    : js`await import(${importPath})`,
                  type: v.type,
                  pattern: v.pattern,
                  routePattern: v.routePattern,
                  css: toJsRaw(css),
                }));
                assertAbsolutePath(v.filePath);
                return {
                  ...v,
                  css,
                  mod: v.lazy
                    ? () => this.importHelper(v.filePath)
                    : await this.importHelper(v.filePath),
                };
              }),
            );
            cacheOut.push(js`const fsRoutes=${fsRoutesOut}`);

            const clientEntrypoint = compilation.entrypoints.get(
              "client-entry",
            );
            assert(
              clientEntrypoint,
              `unable to find client entrypoint`,
            );
            const clientEntry = getMainChunkName(
              `/`,
              clientEntrypoint,
            );
            const clientEntryAssets = getChunkFiles(
              `/`,
              clientEntrypoint,
            );
            const staticFilesOut = new Map<string, JsRaw>();
            for (const _asset of compilation.getAssets()) {
              const asset = compilation.getAsset(_asset.name)!;
              const file_: Uint8Array<ArrayBufferLike> = assets[asset.name]
                .buffer();
              const file = file_ as Uint8Array<ArrayBuffer>;
              const hash = await crypto.subtle.digest("SHA-1", file.buffer);

              const ext = extnamePosix(asset.name);
              const contentType = getStdContentType(ext) ?? "text/plain";

              const name = "/" + asset.name;
              staticFiles.set(name, {
                name,
                filePath: asset.name,
                contentType,
                hash: encodeHex(hash),
                data: file,
                size: file.length,
              });
              staticFilesOut.set(
                name,
                toJsRaw({
                  name,
                  filePath:
                    js`new URL(${asset.name}, import.meta.url).pathname`,
                  hash: encodeHex(hash),
                  contentType,
                }),
              );
            }
            cacheOut.push(js`const staticFiles=${staticFilesOut}`);

            cacheOut.push(
              js`export default new ProdBuildCache(${compilation.freshRoot}, ${({
                version: compilationId,
                clientEntry,
                entryAssets: toJsRaw(clientEntryAssets),
                islands: js`islands`,
                fsRoutes: js`fsRoutes`,
                staticFiles: js`staticFiles`,
              })})`,
            );
            // Here ProdBuildCache is being used as MemoryBuildCache from fresh
            const cache = new ProdBuildCache(compilation.freshRoot, {
              version: compilationId,
              clientEntry,
              fsRoutes,
              staticFiles,
              islands,
              entryAssets: clientEntryAssets,
            });
            cache.readFile = (pathname) => {
              const st = staticFiles.get(pathname);
              if (!st) {
                return Promise.resolve(null);
              }
              return Promise.resolve({
                contentType: st.contentType,
                hash: st.hash,
                readable: new ReadableStream({
                  start(v) {
                    v.enqueue(st.data);
                    v.close();
                  },
                }),
                size: st.size,
                close() {},
              });
            };
            compilation.prodBuildCache = cache;

            compilation.emitAsset(
              "./cache.mjs",
              new compiler.webpack.sources.RawSource(
                cacheOut.map((v) => v._jsRaw).join("\n"),
              ),
            );
          },
        );

        const item = await crawlFsItem({
          islandDir: this.resolvePath(this.options.islandDir ?? "islands"),
          routeDir: this.resolvePath(this.options.routeDir ?? "routes"),
          ignore: this.options.ignore ?? [TEST_FILE_PATTERN],
        });
        compilation.freshRoutes = item.routes;
        compilation.freshIslands = [];
        compilation.freshRouteCss = [];
        compilation.freshRoot = this.pathRelativeToBase(".");
        this.#islandFiles = new Set(item.islands);

        const addEntryPromises = [];
        if (routeCssEnabled) {
          let routeId = 0;
          for (const route of item.routes) {
            if ((route.type as string) === "middleware") continue;
            const name = compiler.options.mode === "production"
              ? `rc${routeId++}`
              : `rc${manglePath(route.filePath)}`;
            compilation.freshRouteCss.push({
              entryName: name,
              filePath: route.filePath,
            });
            addEntryPromises.push(
              new Promise<void>((res, rej) =>
                compilation.addEntry(
                  "",
                  Webpack.EntryPlugin.createDependency(route.filePath, {
                    name,
                  }),
                  {
                    name,
                    layer: ROUTE_CSS_LAYER,
                    runtime: ROUTE_CSS_RUNTIME,
                    library: {
                      type: "module",
                    },
                  },
                  (err) => {
                    if (err) return rej(err);
                    res();
                  },
                )
              ),
            );
          }
        }
        let isId = 0;
        for (const island of item.islands) {
          const name = compiler.options.mode === "production"
            ? `is${isId++}`
            : manglePath(island);
          compilation.freshIslands.push({ entryName: name, filePath: island });
          addEntryPromises.push(
            new Promise<void>((res, rej) =>
              compilation.addEntry(
                "",
                Webpack.EntryPlugin.createDependency(`${island}`, {
                  name,
                }),
                {
                  name,
                  library: {
                    type: "module",
                  },
                },
                (err) => {
                  if (err) return rej(err);
                  res();
                },
              )
            ),
          );
        }
        {
          const name = "client-entry";
          const file = this.resolvePath(
            this.options.clientEntry ?? "./client.ts",
          );
          addEntryPromises.push(
            new Promise<void>((res, rej) =>
              compilation.addEntry(
                "",
                Webpack.EntryPlugin.createDependency(file, {
                  name,
                }),
                {
                  name,
                  library: {
                    type: "module",
                  },
                },
                (e) => {
                  if (e) return rej(e);
                  res();
                },
              )
            ),
          );
        }
        await Promise.all(addEntryPromises);
      },
    );
  }
}
