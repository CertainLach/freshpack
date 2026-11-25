import { App, type Middleware } from "@freshpack/core";
import {
  type ProdBuildCache,
  setBuildCache,
  setErrorInterceptor,
} from "@freshpack/core/internal";
import {
  automaticWorkspaceFolders,
  devErrorOverlay,
} from "@freshpack/core/internal-dev";
import type Webpack from "webpack";
import { assertFreshCompilation } from "@freshpack/webpack/fresh";
import { assertUnmapCompilation } from "@freshpack/webpack/unmap";
import { setUnmapping } from "./internal.ts";
import * as memfs from "memfs";
import { AsyncLocalStorage } from "node:async_hooks";

export const HMR_PATH = "/_fresh/hmr";

type Handler = (
  req: Request,
  info: Deno.ServeHandlerInfo,
) => Promise<Response>;

export interface DevApp<State> {
  handler: Handler;
  setBuildCache(cache: ProdBuildCache<State>): void;
}

export function createDevApp<State>(
  app: App<State>,
  root: string,
  ...middlewares: Middleware<State>[]
): DevApp<State> {
  const requestErrors = new AsyncLocalStorage<{ error?: unknown }>();
  setErrorInterceptor(app, (error) => {
    const store = requestErrors.getStore();
    if (store !== undefined) store.error = error;
  });

  let appHandler = app.handler();
  const devApp = new App<State>({ mode: "development" });
  for (const middleware of middlewares) devApp.use(middleware);
  devApp
    .use(automaticWorkspaceFolders(root))
    .use(devErrorOverlay())
    .all("*", async (ctx) => {
      const store: { error?: unknown } = {};
      const res = await requestErrors.run(
        store,
        () => appHandler(ctx.req, ctx.info),
      );
      const isHtml = res.headers.get("content-type")?.includes("text/html");
      if (store.error !== undefined && res.status >= 500 && !isHtml) {
        await res.body?.cancel();
        throw store.error;
      }
      return res;
    });
  let devHandler = devApp.handler();

  return {
    handler: (req, info) => devHandler(req, info),
    setBuildCache(cache) {
      cache.features.errorOverlay = true;
      setBuildCache(app, cache, "production");
      setBuildCache(devApp, cache, "development");
      appHandler = app.handler();
      devHandler = devApp.handler();
    },
  };
}

export function createDevHandler<State>(
  app: App<State>,
  compiler: Webpack.Compiler,
): Handler {
  compiler.outputFileSystem = memfs.createFsFromVolume(
    new memfs.Volume(),
  ) as unknown as Webpack.Compiler["outputFileSystem"];

  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const broadcast = (message: unknown) => {
    const chunk = encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
    for (const client of clients) client.enqueue(chunk);
  };

  const hmrEvents: Middleware<State> = (ctx) => {
    if (ctx.url.pathname !== HMR_PATH) return ctx.next();
    let client: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        client = controller;
        clients.add(client);
        client.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        clients.delete(client);
      },
    });
    return Promise.resolve(
      new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      }),
    );
  };

  const dev = createDevApp(app, compiler.context, hmrEvents);

  let compiled = Promise.withResolvers<void>();
  compiler.hooks.invalid.tap("FreshpackDev", () => {
    compiled = Promise.withResolvers();
    broadcast("invalid");
  });
  compiler.hooks.failed.tap("FreshpackDev", (err) => {
    console.error("webpack failed", err);
    compiled.resolve();
  });
  compiler.hooks.done.tap("FreshpackDev", (stats) => {
    console.info(stats.toString(compiler.options.stats));
    assertFreshCompilation(stats.compilation);
    assertUnmapCompilation(stats.compilation);
    dev.setBuildCache(
      stats.compilation.prodBuildCache as ProdBuildCache<State>,
    );
    setUnmapping(stats.compilation.unmapping);
    broadcast({
      done: {
        hash: stats.hash,
        reload: stats.compilation.freshReload,
      },
    });
    compiled.resolve();
  });

  if (compiler.options.watch) {
    compiler.watch(compiler.options.watchOptions, () => {});
  } else {
    console.warn(
      "watching is disabled, server won't be reloaded automatically!",
    );
    compiler.run(() => {});
  }

  return async (req, info) => {
    await compiled.promise;
    return dev.handler(req, info);
  };
}
