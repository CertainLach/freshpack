/* Build configuration used by dev server, and server builder */

import Webpack from "webpack";
import CopyPlugin from "copy-webpack-plugin";
import { DenoPreactRefreshPlugin, FreshPlugin } from "@freshpack/webpack";

const DEBUG_RESOLVED = false;

export function createConfig(
  mode: "development" | "production",
): Webpack.Configuration {
  return {
    mode,
    target: "web",
    // Note: if you don't want to use webpack css support, you should not remove `entry` key completely,
    // instead replace it with `entry: {}` so webpack does not use its own default entry handling.
    // Island entries are created automatically, no need to specify them here.
    entry: {},
    optimization: {
      runtimeChunk: "single",
      usedExports: true,
      providedExports: true,
      splitChunks: {
        chunks: "all",
        maxInitialRequests: Infinity,
        maxAsyncRequests: Infinity,
      },
    },
    output: {
      clean: true,
      chunkFormat: "module",
      chunkLoading: "import",
      workerChunkLoading: "import",
    },
    module: {
      rules: [
        {
          test: /\.(css)$/,
          type: "css",
        },
      ],
    },
    resolve: {
      // Optional: use react libraries with preact
      // alias: {
      //   "react": "preact/compat",
      //   "react-dom": "preact/compat",
      //   "react/jsx-runtime": "preact/jsx-runtime",
      // },

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
    devtool: mode === "production" ? "source-map" : "cheap-module-source-map",
    plugins: [
      mode !== "production" ? new Webpack.HotModuleReplacementPlugin() : null,
      mode !== "production" ? new DenoPreactRefreshPlugin({}) : null,

      new FreshPlugin(new URL(".", import.meta.url), (path) => import(path), {
        deno: { debug: DEBUG_RESOLVED },
        hot: import.meta.hot,
      }),

      // Copied assets are added to build cache.
      new CopyPlugin({ patterns: ["static"] }),
    ].filter((v) => v !== null),
  };
}

if (import.meta.main) {
  const config = createConfig("production");
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
