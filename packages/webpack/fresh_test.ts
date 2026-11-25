import Webpack from "webpack";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl, join, toFileUrl } from "@std/path";
import { App, staticFiles } from "@freshpack/core";
import { type ProdBuildCache, setBuildCache } from "@freshpack/core/internal";
import { assertFreshCompilation, FreshPlugin } from "./fresh.ts";

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

async function build(): Promise<ProdBuildCache<unknown>> {
  const compiler = Webpack({
    mode: "production",
    target: "web",
    entry: {},
    devtool: false,
    optimization: {
      runtimeChunk: "single",
      splitChunks: { chunks: "all" },
    },
    output: {
      path: DIST,
      clean: true,
      chunkFormat: "module",
      chunkLoading: "import",
      workerChunkLoading: "import",
    },
    plugins: [
      new FreshPlugin(FIXTURE, (specifier) => import(specifier)),
      new EmitStaticPlugin(),
    ],
  })!;
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

async function routeStylesheets(): Promise<string[]> {
  const cacheSource = await Deno.readTextFile(join(DIST, "cache.mjs"));
  const match = /id:"\/index"[^}]*?css:\[([^\]]*)\]/.exec(cacheSource);
  assert(match, "route /index not found in cache.mjs");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
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
