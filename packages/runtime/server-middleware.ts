import type { App, Context, Middleware } from "@fresh/core";
import { setBuildCache } from "@fresh/core/internal";
import type Webpack from "webpack";
import { assertFreshCompilation } from "@freshpack/webpack/fresh";
import { assertUnmapCompilation } from "@freshpack/webpack/unmap";
import { setUnmapping } from "./internal.ts";

export function webpackHandler<State>(
  app: App<State>,
  compiler: Webpack.Compiler,
): (ctx: Context<State>) => Promise<Response | Middleware<State>> {
  const hmrWatchers = new Set<WebSocket>();
  const broadcast = (v: unknown) => {
    const json = JSON.stringify(v);
    for (const watcher of hmrWatchers) {
      watcher.send(json);
    }
  };

  compiler.hooks.failed.tap("FreshpackHMR", (e) => {
    console.error("webpack failed", e);
  });
  compiler.hooks.invalid.tap("FreshpackHMR", () => {
    console.error("webpack invalid");
    broadcast("invalid");
  });
  // deno-ignore: require-await
  compiler.hooks.done.tapPromise({
    name: "FreshpackHMR",
    before: "FreshpackCompilingWait",
  }, async (stats) => {
    console.info(stats.toString(compiler.options.stats));
    broadcast({ done: { hash: stats.hash } });

    assertFreshCompilation(stats.compilation);
    assertUnmapCompilation(stats.compilation);

    setBuildCache(
      app as App<unknown>,
      stats.compilation.prodBuildCache,
      "production",
    );
    setUnmapping(stats.compilation.unmapping);
  });

  if (compiler.options.watch) {
    compiler.watch(compiler.options.watchOptions, () => {
      // Failure/success is handled by hooks
    });
  } else {
    console.warn(
      "watching is disabled, server won't be reloaded automatically!",
    );
    compiler.compile(() => {
      // Failure/success is handled by hooks
    });
  }

  return (ctx) => {
    if (ctx.url.pathname.endsWith("/__freshpack_hmr")) {
      const { response, socket } = Deno.upgradeWebSocket(ctx.req);

      socket.addEventListener("open", () => {
        hmrWatchers.add(socket);
      });
      socket.addEventListener("close", () => {
        hmrWatchers.delete(socket);
      });
      return Promise.resolve(response);
    }
    if (ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
      return ctx.next();
    }
    return ctx.next();
  };
}

export function mkCompilingWaiter(
  compiler: Webpack.Compiler,
): () => Promise<void> {
  let waiter = Promise.withResolvers<void>();

  compiler.hooks.failed.tap("FreshpackCompilingWait", () => {
    waiter.resolve();
  });
  compiler.hooks.invalid.tap("FreshpackCompilingWait", () => {
    waiter = Promise.withResolvers();
  });
  compiler.hooks.done.tap("FreshpackCompilingWait", () => {
    waiter.resolve();
  });

  return () => waiter.promise;
}
