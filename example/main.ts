/* This server entry point uses client prebuilt witn build.ts file */

import { app } from "./app.ts";
import { setBuildCache } from "@fresh/core/internal";

if (import.meta.main) {
  const cache = (await import("./dist/cache.mjs")).default;
  setBuildCache(app, cache, "production");

  const handler = app.handler();
  Deno.serve({ port: 8000 }, (req, info) => {
    return handler(req, info);
  });
}
