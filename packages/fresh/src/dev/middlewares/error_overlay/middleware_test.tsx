import { expect, fn } from "@std/expect";
import { App } from "../../../app.ts";
import { FakeServer } from "../../../test_utils.ts";
import { devErrorOverlay } from "./middleware.tsx";
import { HttpError } from "../../../error.ts";
import { DEV_ERROR_OVERLAY_URL } from "../../../constants.ts";

function withDevOverlay(app: App<unknown>): App<unknown> {
  const handler = app.handler();
  const devApp = new App({ mode: "development" })
    .use(devErrorOverlay())
    .all("*", (ctx) => handler(ctx.req, ctx.info));
  return devApp;
}

Deno.test("error overlay - doesn't overtake _error handler", async () => {
  const app = new App()
    .onError("*", () => new Response("it works"))
    .get("/", () => new Response("no"));

  const server = new FakeServer(withDevOverlay(app).handler());
  const res = await server.get("/invalid");

  expect(await res.text()).toEqual("it works");
});

Deno.test("error overlay - ignores _app and _layout", async () => {
  const appLayoutSpy = fn(() => "app or layout") as () => string;
  const app = new App()
    .appWrapper(appLayoutSpy)
    .layout("/", appLayoutSpy);

  const server = new FakeServer(withDevOverlay(app).handler());
  const res = await server.get(`${DEV_ERROR_OVERLAY_URL}?message=__ok__`);

  expect(await res.text()).toMatch(/__ok__/);
  expect(appLayoutSpy).toHaveBeenCalledTimes(0);
});

Deno.test("error overlay - show when error is thrown", async () => {
  const app = new App();
  app.use(devErrorOverlay());
  app.config.mode = "development";

  app.get("/", () => {
    throw new Error("fail");
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/", {
    headers: {
      accept: "text/html",
    },
  });
  const content = await res.text();
  expect(content).toContain("fresh-error-overlay");
});

Deno.test("error overlay - should not be visible for HttpError <500", async () => {
  const app = new App();
  app.use(devErrorOverlay());
  app.config.mode = "development";

  app
    .get("/", () => {
      throw new HttpError(404);
    })
    .get("/500", () => {
      throw new HttpError(500);
    });

  const server = new FakeServer(app.handler());
  let res = await server.get("/", {
    headers: {
      accept: "text/html",
    },
  });
  let content = await res.text();
  expect(content).not.toContain("fresh-error-overlay");
  expect(res.status).toEqual(404);

  res = await server.get("/500", {
    headers: {
      accept: "text/html",
    },
  });
  content = await res.text();
  expect(content).toContain("fresh-error-overlay");
  expect(res.status).toEqual(500);
});

Deno.test(
  "error overlay - should not be visible for HttpError <500 #2",
  async () => {
    const app = new App();
    app.use(devErrorOverlay());
    app.config.mode = "development";
    app
      .use(async (ctx) => {
        try {
          return await ctx.next();
        } catch {
          return ctx.render(<p>ok</p>);
        }
      })
      .get("/", () => {
        throw new HttpError(404);
      });

    const server = new FakeServer(app.handler());
    const res = await server.get("/", {
      headers: {
        accept: "text/html",
      },
    });
    const content = await res.text();
    expect(content).not.toContain("fresh-error-overlay");
  },
);

Deno.test("error overlay - should not be visible in prod", async () => {
  const app = new App({ mode: "production" });
  app.use(devErrorOverlay());

  app.get("/", () => {
    throw new HttpError(500);
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/", {
    headers: {
      accept: "text/html",
    },
  });
  const content = await res.text();
  expect(content).not.toContain("fresh-error-overlay");
  expect(res.status).toEqual(500);
});
