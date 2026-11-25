import { expect } from "@std/expect";
import { App } from "../../app.ts";
import { FakeServer } from "../../test_utils.ts";
import { automaticWorkspaceFolders } from "./automatic_workspace_folders.ts";

Deno.test("automaticWorkspaceFolders - serves devtools workspace", async () => {
  const root = "/srv/project";
  const app = new App().use(automaticWorkspaceFolders(root));

  const server = new FakeServer(app.handler());
  const res = await server.get(
    "/.well-known/appspecific/com.chrome.devtools.json",
  );
  const json = await res.json();

  expect(res.status).toBe(200);
  expect(res.headers.get("etag")).toEqual(expect.any(String));
  expect(json).toEqual({ workspace: { root, uuid: expect.any(String) } });
});
