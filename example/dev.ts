/* Dev server entrypoint */

import Webpack from "webpack";
import { app } from "./app.ts";
import { createDevHandler } from "@freshpack/runtime/server-middleware";
import { createConfig } from "./build.ts";

if (import.meta.main) {
  const handler = createDevHandler(app, Webpack(createConfig("development"))!);
  Deno.serve({ port: 8000 }, handler);
}
