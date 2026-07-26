/* Dev server entrypoint */

import Webpack from "webpack";
import { app } from "./app.ts";
import {
  mkCompilingWaiter,
  webpackHandler,
} from "@freshpack/runtime/server-middleware";
import { createConfig } from "./build.ts";

if (import.meta.main) {
  const config = createConfig("development");
  const webpack = Webpack(config)!;
  app
    // webpackHandler combines HMR, devserver middleware, and updates app's build cache...
    // Would be better to split it somehow
    .use(webpackHandler(app, webpack));

  const waiter = mkCompilingWaiter(webpack);
  Deno.serve({ port: 8000 }, async (req, info) => {
    // Compilation waiter postpones response until webpack thinks the build is finished,
    // it is required because the fresh build cache might not be ready at this point, and app handler still
    // needs to be recreated for the new cache to be taken into effect.
    await waiter();
    // app.handler getter needs to be recreated for every request for build cache change to be reflected
    return app.handler()(req, info);
  });
}
