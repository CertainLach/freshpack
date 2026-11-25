import { App } from "@freshpack/core";
import { ProdBuildCache } from "@freshpack/core/internal";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { createDevApp } from "./server-middleware.ts";

const INFO = {
  remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
  completed: Promise.resolve(),
} as unknown as Deno.ServeHandlerInfo;

function devApp(app: App<unknown>) {
  const dev = createDevApp(app, "/srv/project");
  dev.setBuildCache(
    new ProdBuildCache("", {
      version: "test",
      clientEntry: "/client.mjs",
      fsRoutes: [],
      staticFiles: new Map(),
      islands: new Map(),
      entryAssets: [],
    }),
  );
  return dev;
}

function get(path: string, accept = "text/html") {
  return new Request(`http://localhost${path}`, { headers: { accept } });
}

Deno.test("createDevApp - shows error overlay for uncaught errors", async () => {
  const app = new App().get("/", () => {
    throw new Error("boom");
  });

  const res = await devApp(app).handler(get("/"), INFO);
  const html = await res.text();

  assertEquals(res.status, 500);
  assertStringIncludes(html, "fresh-error-overlay");
  assertStringIncludes(html, "message=boom");
});

Deno.test("createDevApp - keeps plain errors for non-html requests", async () => {
  const app = new App().get("/", () => {
    throw new Error("boom");
  });

  const res = await devApp(app).handler(get("/", "application/json"), INFO);

  assertEquals(res.status, 500);
  assertEquals(await res.text(), "Internal server error");
});

Deno.test("createDevApp - doesn't overtake app error handler", async () => {
  const app = new App()
    .onError("*", () => new Response("it works"))
    .get("/", () => new Response("no"));

  const res = await devApp(app).handler(get("/invalid"), INFO);

  assertEquals(await res.text(), "it works");
});

Deno.test("createDevApp - passes through app responses", async () => {
  const app = new App().get("/", () => new Response("ok"));

  const res = await devApp(app).handler(get("/"), INFO);

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("createDevApp - serves error overlay page", async () => {
  const res = await devApp(new App()).handler(
    get("/_frsh/error_overlay?message=__ok__"),
    INFO,
  );

  assertStringIncludes(await res.text(), "__ok__");
});

Deno.test("createDevApp - serves devtools workspace folder", async () => {
  const res = await devApp(new App()).handler(
    get("/.well-known/appspecific/com.chrome.devtools.json"),
    INFO,
  );
  const json = await res.json();

  assertEquals(json.workspace.root, "/srv/project");
});
