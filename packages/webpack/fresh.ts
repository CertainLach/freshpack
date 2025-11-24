import { crawlFsItem, type FsRouteFileNoMod } from "@fresh/core/internal-dev";
import Webpack from "webpack";
import { assertAbsolutePath, manglePath, stripFileUrl } from "./util.ts";
import { assert } from "@std/assert";
import { IslandPreparer, ProdBuildCache } from "@fresh/core/internal";
import { extname as extnamePosix, join as joinPosix } from "@std/path/posix";
import { contentType as getStdContentType } from "@std/media-types/content-type";
import { encodeHex } from "@std/encoding";
import { UnmapPlugin } from "./unmap.ts";

interface WebpackFreshCompilation extends Webpack.Compilation {
  freshRoutes: FsRouteFileNoMod<unknown>[];
  freshIslands: { entryName: string; filePath: string }[];
  freshRoot: string;

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
  hash: string;
  contentType: string;
  data: Uint8Array;
  size: number;
};

const TMP_BASE_PATH = "/";
function getMainChunkName(
  basePath: string,
  e: Webpack.Entrypoint,
): string {
  const entryChunk = e.getEntrypointChunk();
  const files = [...entryChunk.files].map((v) => joinPosix(basePath, v));
  return files[0];
}

export class FreshPlugin {
  constructor(public baseUrl: URL) {
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

    compiler.hooks.make.tapPromise(
      FreshPlugin.name,
      async (_compilation: Webpack.Compilation) => {
        const compilation = _compilation as WebpackFreshCompilation;

        compilation.hooks.processAssets.tapPromise(
          FreshPlugin.name,
          async (assets) => {
            const cacheOut: string[] = [
              "const islands=new Map()",
              "const islandPreparer=new IslandPreparer()",
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
                TMP_BASE_PATH,
                entrypoint,
              );

              islandPreparer.prepare(
                islands,
                await import(island.filePath),
                file,
                island.entryName,
                [],
              );
              cacheOut.push(
                `islandPreparer.prepare(islands,await import(${
                  JSON.stringify(island.filePath)
                }),${JSON.stringify(file)},${JSON.stringify(island.entryName),
                  []})`,
              );
            }

            const fsRoutes = await Promise.all(
              compilation.freshRoutes.map(async (v) => {
                assertAbsolutePath(v.filePath);
                return {
                  ...v,
                  mod: v.lazy
                    ? () => import(v.filePath)
                    : await import(v.filePath),
                };
              }),
            );

            const clientEntrypoint = compilation.entrypoints.get(
              "client-entry",
            );
            assert(
              clientEntrypoint,
              `unable to find client entrypoint`,
            );
            // console.log("EPP", clientEntrypoint.getFiles());
            const clientEntry = getMainChunkName(
              TMP_BASE_PATH,
              clientEntrypoint,
            );
            for (const _asset of compilation.getAssets()) {
              const asset = compilation.getAsset(_asset.name)!;
              // const assetPath = join(compilation.outputOptions.path, asset.name);
              const file_: Uint8Array<ArrayBufferLike> = assets[asset.name]
                .buffer();
              const file = file_ as Uint8Array<ArrayBuffer>;
              // const file: Uint8Array<ArrayBuffer> = await new Promise((res, rej) =>
              //   compiler.outputFileSystem!.readFile(assetPath, (e, f) => {
              //     if (e) return rej(e);
              //     return res(f! as Uint8Array<ArrayBuffer>);
              //   })
              // );
              const hash = await crypto.subtle.digest("SHA-1", file.buffer);
              // console.log(asset.name, asset.source, asset.info);

              const ext = extnamePosix(asset.name);
              const contentType = getStdContentType(ext) ?? "text/plain";
              staticFiles.set("/" + asset.name, {
                name: asset.name,
                filePath: asset.name,
                hash: encodeHex(hash),
                contentType,

                data: file,
                size: file.length,
              });
            }

            const cache = new ProdBuildCache(compilation.freshRoot, {
              version: Date.now().toString(),
              clientEntry,
              fsRoutes,
              staticFiles,
              islands,
              entryAssets: [],
            });
            cache.readFile = (pathname) => {
              const st = staticFiles.get(pathname);
              if (!st) return Promise.resolve(null);
              // console.log("readStatic", pathname, st);
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
          },
        );

        const item = await crawlFsItem({
          islandDir: stripFileUrl(new URL("islands", this.baseUrl).href),
          routeDir: stripFileUrl(new URL("routes", this.baseUrl).href),
          ignore: [],
        });
        compilation.freshRoutes = item.routes;
        compilation.freshIslands = [];
        compilation.freshRoot = stripFileUrl(this.baseUrl.href);

        const addEntryPromises = [];
        for (const island of item.islands) {
          const name = manglePath(island);
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
                  // filename: `${name}.mjs`,
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
          // console.log(name, file);
          addEntryPromises.push(
            new Promise<void>((res, rej) =>
              compilation.addEntry(
                "",
                Webpack.EntryPlugin.createDependency(file, {
                  name,
                }),
                {
                  name,
                  // filename: 'client-entry.mjs',
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
