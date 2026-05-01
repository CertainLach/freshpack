/* Client entrypoint. Unlike fresh builder, is explicit, and allows to customize what the client is going to do */

import { boot } from "@fresh/core/runtime-client";

if (Deno.env.get("NODE_ENV") !== "production") {
  // For preact devtools
  await import("preact/debug");
  // Client-side of hmr, connects to server middleware websocket and calls webpack on update
  await import("@freshpack/runtime/client-hmr");
}

// boot export is called by fresh itself
export { boot };
