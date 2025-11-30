/* Build configuration used by dev server, and server builder */

import Webpack from "webpack";
import CopyPlugin from "copy-webpack-plugin";
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
    // Needs to be empty to disable default entry creation, fresh plugin creates its own entries
    // automatically.
    entry: {},
    optimization: {
      runtimeChunk: "single",
      usedExports: true,
      providedExports: true,
      splitChunks: {
        chunks: "all",
        maxInitialRequests: Infinity,
        maxAsyncRequests: Infinity,
        cacheGroups: {
          // defaultVendor doesn't work with deno, if you want assets to be grouped - it needs to be done explicitly
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
      chunkFormat: "module",
      chunkLoading: "import",
      workerChunkLoading: "import",
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
                [(await import("@freshpack/babel/env")).default, {}],
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
    devtool: mode === "production" ? "source-map" : "cheap-source-map",
    plugins: [
      mode !== "production" ? new Webpack.HotModuleReplacementPlugin() : null,
      mode !== "production" ? new DenoPreactRefreshPlugin({}) : null,

      new DenoLoaderPlugin({ debug: DEBUG_RESOLVED }),

      new FreshPlugin(new URL(".", import.meta.url), (path) => import(path)),

      // Copied assets are added to build cache.
      new CopyPlugin({ patterns: ["static"] }),
    ].filter((v) => v !== null),
  };
}

if (import.meta.main) {
  Deno.env.set("NODE_ENV", "production");
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
