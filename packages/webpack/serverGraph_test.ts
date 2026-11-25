import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ServerGraphRules } from "./serverGraph.ts";

async function fixture(): Promise<string> {
  const base = join(await Deno.makeTempDir(), "islands", "project");
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "app" }),
    "routes/index.ts": "",
    "routes/(_islands)/Local.tsx": "",
    "islands/Counter.tsx": "",
    "components/islands/Nested.tsx": "",
    "node_modules/lib/package.json": JSON.stringify({ name: "lib" }),
    "node_modules/lib/util.js": "",
    "node_modules/lib/islands/Widget.js": "",
    "node_modules/@scope/pkg/package.json": JSON.stringify({
      name: "@scope/pkg",
    }),
    "node_modules/@scope/pkg/mod.js": "",
  };
  for (const [name, content] of Object.entries(files)) {
    const path = join(base, name);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  return base;
}

Deno.test("ServerGraphRules - detects island path segments", async () => {
  const root = await fixture();
  const rules = new ServerGraphRules(root);
  const island = (path: string) => rules.isIsland(join(root, path));

  assertEquals(island("islands/Counter.tsx"), true);
  assertEquals(island("components/islands/Nested.tsx"), true);
  assertEquals(island("routes/(_islands)/Local.tsx"), true);
  assertEquals(island("node_modules/lib/islands/Widget.js"), true);
  assertEquals(island("routes/index.ts"), false);
  assertEquals(island("node_modules/lib/util.js"), false);
});

Deno.test("ServerGraphRules - crawled island files are islands", async () => {
  const root = await fixture();
  const path = join(root, "routes/index.ts");
  const rules = new ServerGraphRules(root, {}, new Set([path]));

  assertEquals(rules.isIsland(path), true);
});

Deno.test("ServerGraphRules - follows everything by default", async () => {
  const root = await fixture();
  const rules = new ServerGraphRules(root);

  assertEquals(rules.follow(join(root, "routes/index.ts")), true);
  assertEquals(rules.follow(join(root, "node_modules/lib/util.js")), true);
  assertEquals(
    rules.follow(join(root, "node_modules/@scope/pkg/mod.js")),
    true,
  );
});

Deno.test("ServerGraphRules - exclude by package name and path", async () => {
  const root = await fixture();
  const byName = new ServerGraphRules(root, { exclude: ["lib"] });
  const byPath = new ServerGraphRules(root, { exclude: [/\/@scope\//] });

  assertEquals(byName.follow(join(root, "node_modules/lib/util.js")), false);
  assertEquals(
    byName.follow(join(root, "node_modules/@scope/pkg/mod.js")),
    true,
  );
  assertEquals(
    byPath.follow(join(root, "node_modules/@scope/pkg/mod.js")),
    false,
  );
});

Deno.test("ServerGraphRules - include limits dependencies only", async () => {
  const root = await fixture();
  const rules = new ServerGraphRules(root, { include: ["@scope/*"] });

  assertEquals(rules.follow(join(root, "routes/index.ts")), true);
  assertEquals(
    rules.follow(join(root, "node_modules/@scope/pkg/mod.js")),
    true,
  );
  assertEquals(rules.follow(join(root, "node_modules/lib/util.js")), false);
});
