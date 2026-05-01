import { crawlFsItem, type FsRouteFileNoMod } from "@fresh/core/internal-dev";
import Webpack from "webpack";
import {
  assertAbsolutePath,
  assertDirURL,
  manglePath,
  stripFileUrl,
} from "./util.ts";
import { assert } from "@std/assert";
import { IslandPreparer, ProdBuildCache } from "@fresh/core/internal";
import {
  extname as extnamePosix,
  join as joinPosix,
  relative as relativePosix,
} from "@std/path/posix";
import { contentType as getStdContentType } from "@std/media-types/content-type";
import { encodeHex } from "@std/encoding";
import { UnmapPlugin } from "./unmap.ts";
import { js, type JsRaw, toJsRaw } from "./quasiquote.ts";

interface WebpackFreshCompilation extends Webpack.Compilation {
  freshRoutes: FsRouteFileNoMod<unknown>[];
  freshIslands: { entryName: string; filePath: string }[];
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

function getMainChunkName(
  basePath: string,
  e: Webpack.Entrypoint,
): string {
  const entryChunk = e.getEntrypointChunk();
  const files = [...entryChunk.files].map((v) => joinPosix(basePath, v));
  return files[0];
}
function getChunkFiles(
  basePath: string,
  e: Webpack.Entrypoint,
): string[] {
  return e.getFiles().map((v) => joinPosix(basePath, v));
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
  pathRelativeToBase(path: string) {
    return relativePosix(this.baseUrl.pathname, path);
  }
  #dist?: string;
  pathRelativeToDist(path: string) {
    assert(this.#dist, "dist path was not determined yet");
    return relativePosix(this.#dist, path);
  }

  apply(compiler: Webpack.Compiler) {
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
    // Some @std and other packages detect deno on presence of Deno global, dead-code-elimnate this stuff
    (new Webpack.DefinePlugin({ Deno: "undefined" })).apply(compiler);

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
            compilation.outputOptions.filename = `_fresh/js/c/[chunkhash].mjs`;
            compilation.outputOptions.chunkFilename =
              `_fresh/js/c/[chunkhash].mjs`;
          } else {
            compilation.outputOptions.filename =
              `_fresh/js/${compilationId}/[id].mjs`;
            compilation.outputOptions.chunkFilename =
              `_fresh/js/${compilationId}/[id].mjs`;
          }
          // Assets are always content-addressed
          compilation.outputOptions.assetModuleFilename =
            `_fresh/js/c/[hash][ext][query]`;
        }

        compilation.hooks.processAssets.tapPromise(
          {
            name: FreshPlugin.name,
            stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
          },
          async (assets) => {
            compilation.getAssets();

            const cacheOut: JsRaw[] = [
              js`import{IslandPreparer,ProdBuildCache}from"@fresh/core/internal"`,
              js`const islands=new Map()`,
              js`const islandPreparer=new IslandPreparer()`,
            ];

            const staticFiles = new Map<string, CacheStaticFile>();

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

              islandPreparer.prepare(
                islands,
                await this.importHelper(island.filePath),
                file,
                island.entryName,
                [],
              );
              const importPath = this.pathRelativeToDist(island.filePath);
              cacheOut.push(
                js`islandPreparer.prepare(islands,await import(${importPath}),${file},${island.entryName},[])`,
              );
            }

            const fsRoutesOut: JsRaw[] = [];
            const fsRoutes = await Promise.all(
              compilation.freshRoutes.map(async (v) => {
                const importPath = this.pathRelativeToDist(v.filePath);
                fsRoutesOut.push(toJsRaw({
                  id: v.id,
                  mod: v.lazy
                    ? js`()=>import(${importPath})`
                    : js`await import(${importPath})`,
                  type: v.type,
                  pattern: v.pattern,
                  routePattern: v.routePattern,
                }));
                assertAbsolutePath(v.filePath);
                return {
                  ...v,
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
          islandDir: stripFileUrl(new URL("islands", this.baseUrl).href),
          routeDir: stripFileUrl(new URL("routes", this.baseUrl).href),
          ignore: [],
        });
        compilation.freshRoutes = item.routes;
        compilation.freshIslands = [];
        compilation.freshRoot = this.pathRelativeToBase(".");

        const addEntryPromises = [];
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
          const file = stripFileUrl(new URL("./client.ts", this.baseUrl).href);
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
