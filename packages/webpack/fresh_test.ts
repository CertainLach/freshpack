import Webpack from "webpack";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { App, staticFiles } from "@freshpack/core";
import { type ProdBuildCache, setBuildCache } from "@freshpack/core/internal";
import {
  assertFreshCompilation,
  FreshPlugin,
  type FreshPluginOptions,
} from "./fresh.ts";

const FIXTURE = new URL("./tests/fixture_build/", import.meta.url);
const DIST = fromFileUrl(new URL("dist/", FIXTURE));

class EmitStaticPlugin {
  apply(compiler: Webpack.Compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap("EmitStatic", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "EmitStatic",
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          compilation.emitAsset(
            ".well-known/foo.json",
            new sources.RawSource(JSON.stringify({ ok: true })),
          );
          compilation.emitAsset(
            "test/foo.txt",
            new sources.RawSource("nested"),
          );
        },
      );
    });
  }
}

function createCompiler(
  dist: string,
  options: FreshPluginOptions,
): Webpack.Compiler {
  return Webpack({
    mode: "production",
    target: "web",
    entry: {},
    devtool: false,
    optimization: {
      runtimeChunk: "single",
      splitChunks: { chunks: "all" },
    },
    output: {
      path: dist,
      clean: true,
      chunkFormat: "module",
      chunkLoading: "import",
      workerChunkLoading: "import",
    },
    plugins: [
      new FreshPlugin(FIXTURE, (specifier) => import(specifier), options),
      new EmitStaticPlugin(),
    ],
  })!;
}

async function build(
  dist = DIST,
  options: FreshPluginOptions = {},
): Promise<ProdBuildCache<unknown>> {
  const compiler = createCompiler(dist, options);
  const stats = await new Promise<Webpack.Stats>((resolve, reject) =>
    compiler.run((err, stats) => err ? reject(err) : resolve(stats!))
  );
  await new Promise<void>((resolve, reject) =>
    compiler.close((err) => err ? reject(err) : resolve())
  );
  if (stats.hasErrors()) throw new Error(stats.toString("errors-only"));
  const compilation = stats.compilation;
  assertFreshCompilation(compilation);
  return compilation.prodBuildCache;
}

const devCache = await build();

async function prodApp(): Promise<App<unknown>> {
  const { default: cache } = await import(
    toFileUrl(join(DIST, "cache.mjs")).href
  );
  const app = new App().use(staticFiles()).fsRoutes();
  setBuildCache(app, cache, "production");
  return app;
}

async function routeStylesheets(id = "/index", dist = DIST): Promise<string[]> {
  const cacheSource = await Deno.readTextFile(join(dist, "cache.mjs"));
  const match = new RegExp(`id:"${id}"[^}]*?css:\\[([^\\]]*)\\]`).exec(
    cacheSource,
  );
  assert(match, `route ${id} not found in cache.mjs`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

async function routeCss(id: string, dist = DIST): Promise<string> {
  const stylesheets = await routeStylesheets(id, dist);
  return (await Promise.all(
    stylesheets.map((href) => Deno.readTextFile(join(dist, href))),
  )).join("\n");
}

Deno.test("FreshPlugin - route css rewrites url() to emitted assets", async () => {
  const stylesheets = await routeStylesheets();
  const css = (await Promise.all(
    stylesheets.map((href) => Deno.readTextFile(join(DIST, href))),
  )).join("\n");

  const font = /url\((\/_fresh\/js\/c\/[0-9a-f]+\.woff2)\)/.exec(css);
  assert(font, `font url not rewritten in:\n${css}`);
  assertMatch(
    css,
    /url\("?data:image\/svg\+xml,%3Csvg xmlns='http:\/\/www\.w3\.org\/2000\/svg'/,
  );

  const served = await devCache.readFile(font[1]);
  assert(served, `font ${font[1]} is not served from the build cache`);
  served.close();
});

Deno.test("FreshPlugin - serves emitted static files in nested and dot dirs", async () => {
  const handler = (await prodApp()).handler();

  let res = await handler(new Request("http://localhost/.well-known/foo.json"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  res = await handler(new Request("http://localhost/test/foo.txt"));
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "nested");
});

Deno.test("FreshPlugin - cache.mjs serves file routes", async () => {
  const handler = (await prodApp()).handler();

  let res = await handler(new Request("http://localhost/foo"));
  assertEquals(await res.text(), "ok");

  res = await handler(new Request("http://localhost/"));
  assertEquals(await res.text(), "index");
});

Deno.test("FreshPlugin - ignores test files in routes by default", async () => {
  const handler = (await prodApp()).handler();

  const res = await handler(new Request("http://localhost/ignored_test"));
  assertEquals(res.status, 404);
  await res.body?.cancel();

  const cacheSource = await Deno.readTextFile(join(DIST, "cache.mjs"));
  assert(!cacheSource.includes("ignored_test"));
});

Deno.test("FreshPlugin - discovers islands imported from other packages", async () => {
  const cacheSource = await Deno.readTextFile(join(DIST, "cache.mjs"));

  assertMatch(
    cacheSource,
    /\.prepare\([^)]*import\("[^"]*fixture_lib\/islands\/LibIsland\.ts"\)/,
  );
  assert(!cacheSource.includes("UnusedIsland"));

  const island = [...devCache.islandRegistry.values()].find((island) =>
    island.exportName === "LibIsland"
  );
  assert(island, "LibIsland is not registered");
  const res = await devCache.readFile(island.file);
  assert(res, `island chunk ${island.file} is not served`);
  res.close();
});

Deno.test("FreshPlugin - collects styles imported by other packages", async () => {
  assertMatch(await routeCss("/lib"), /\.lib-widget/);
});

Deno.test("FreshPlugin - graph exclude skips packages", async () => {
  const dist = await Deno.makeTempDir();
  await build(dist, { graph: { exclude: ["fixture-lib"] } });
  const cacheSource = await Deno.readTextFile(join(dist, "cache.mjs"));

  assert(!cacheSource.includes("LibIsland"));
  assert(!/\.lib-widget/.test(await routeCss("/lib", dist)));
  await Deno.remove(dist, { recursive: true });
});

Deno.test("FreshPlugin - hot reloads the page unless only islands changed", async () => {
  const accepted = new Map<string, () => void>();
  const statusHandlers: ((status: string) => void)[] = [];
  const dist = await Deno.makeTempDir();
  const compiler = createCompiler(dist, {
    hot: {
      accept: (dep, callback) => accepted.set(dep, callback!),
      addStatusHandler: (handler) => statusHandlers.push(handler),
    },
  });

  let built = Promise.withResolvers<Webpack.Compilation>();
  compiler.hooks.done.tap("Test", (stats) => built.resolve(stats.compilation));
  const watching = compiler.watch({}, () => {})!;

  let compilation = await built.promise;
  assertFreshCompilation(compilation);
  assertEquals(compilation.freshReload, false);
  const island = [...accepted.keys()].find((path) =>
    path.endsWith("LibIsland.ts")
  );
  assert(island, "island is not accepted");

  const serverUpdate = async () => {
    built = Promise.withResolvers();
    accepted.get(island)!();
    for (const handler of statusHandlers) handler("apply");
    for (const handler of statusHandlers) handler("idle");
    const compilation = await built.promise;
    assertFreshCompilation(compilation);
    return compilation.freshReload;
  };
  const edit = async (path: string) => {
    const source = await Deno.readTextFile(path);
    built = Promise.withResolvers();
    await Deno.writeTextFile(path, source + "\nexport const edited = 1;\n");
    await built.promise;
    return () => Deno.writeTextFile(path, source);
  };

  const restore = [];
  try {
    assertEquals(await serverUpdate(), true);

    restore.push(await edit(island));
    assertEquals(await serverUpdate(), false);

    restore.push(
      await edit(fromFileUrl(new URL("routes/lib.ts", FIXTURE))),
    );
    assertEquals(await serverUpdate(), true);
  } finally {
    await new Promise<void>((resolve) => watching.close(() => resolve()));
    for (const fn of restore) await fn();
    await Deno.remove(dist, { recursive: true });
  }
});
