/* Build configuration used by dev server, and server builder */

import Webpack from "webpack";
import {
  DenoLoaderPlugin,
  DenoPreactRefreshPlugin,
  FreshPlugin,
} from "@freshpack/webpack";

const DEBUG_RESOLVED = false;

export async function createConfig(
  mode: "development" | "production",
): Promise<Webpack.Configuration> {
  return {
    mode,
    target: "web",
    entry: {
      // TODO: EntryDependency factory is not registered without any entry
      // specified here. After fix, entry option will not be necessary.
      'dummy': './dummy.ts',
    },
    optimization: {
      runtimeChunk: "single",
      usedExports: true,
      providedExports: true,
      splitChunks: {
        chunks: "all",
        maxInitialRequests: Infinity,
        maxAsyncRequests: Infinity,
        cacheGroups: {
          // defaultVendor doesn't work with deno, better specify all the runtime dependencies manually here
          preact: {
            test: /(preact|prefresh|mobx|fresh)/,
            enforce: true,
            chunks: "all",
            maxInitialRequests: Infinity,
            maxAsyncRequests: Infinity,
          },
        },
      },
    },
    output: {
      clean: true,
      path: new URL("_fresh", import.meta.url).pathname,
      filename: mode === "production" ? "[chunkhash].mjs" : "[id].mjs",
      chunkFormat: "module",
      chunkLoading: "import",
      workerChunkLoading: "import",
      // Important: islands are imported as modules
      module: true,
      enabledLibraryTypes: ["module"],
      library: {
        type: "module",
      },
    },
    module: {
      defaultRules: [],
      rules: [
        {
          type: "javascript/auto",
          // Required for JSR transpilation, as those are in https scheme
          scheme: () => true,
          use: {
            loader: "babel-loader",
            options: {
              targets: "defaults",
              presets: [
                ["@babel/preset-env", { modules: false }],
                ["@babel/preset-typescript"],
              ],
              plugins: [
                // Can't use name here, because babel tries to resolve the module on its own,
                // and also is not accepting .ts files here. To be fixed on babel side?
                [(await import("@freshpack/babel/env")).default()],
                [
                  "@babel/plugin-transform-react-jsx",
                  {
                    "runtime": "automatic",
                    "importSource": "preact",
                  },
                ],
              ],
            },
          },
        },
      ],
    },
    resolve: {
      alias: {
        "react": "preact/compat",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
      },
      // Disable node_modules resolution, only use deno loader
      // TODO: To be disabled by DenoLoaderPlugin
      fallback: {},
      modules: [],
    },
    watch: mode === "development",
    watchOptions: {
      // Assuming JSR dependencies won't change
      ignored: /https:\//,
    },
    stats: {
      colors: true,
    },
    devtool: mode === "production" ? "source-map" : "cheap-source-map",
    plugins: [
      new Webpack.HotModuleReplacementPlugin(),
      new DenoPreactRefreshPlugin({ entryOptions: {} }),
      new DenoLoaderPlugin({ debug: DEBUG_RESOLVED }),

      new FreshPlugin(new URL(import.meta.url)),
    ],
  };
}

if (import.meta.main) {
  const config = await createConfig("production");
  const webpack = Webpack(config)!;
  webpack.run((err, v) => {
    if (err) return console.error(err);
    console.info(v!.toString(config.stats));
    webpack.close((e) => {
      if (e) console.error(e);
      console.info("webpack flushed");
    });
  });
}
// app
//   // webpackHandler combines HMR, devserver middleware, and updates app's build cache...
//   // Would be better to split it somehow
//   .use(webpackHandler(app, webpack))
//   .use((ctx) => {
//     console.log(ctx.req.method, ctx.url.href);
//     return ctx.next();
//   });
//
// const waiter = mkCompilingWaiter(webpack);
// Deno.serve(async (req, info) => {
//   await waiter();
//   // app.handler getter needs to be recreated for every request for build cache change to be reflected
//   return app.handler()(req, info);
// });
