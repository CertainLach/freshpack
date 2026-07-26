import {
  App,
  createOnListen,
  type ListenOptions,
  setBuildCache,
} from "../app.ts";
import { fsAdapter } from "../fs.ts";

import { liveReload } from "./middlewares/live_reload.ts";
import {
  FileTransformer,
  type OnTransformOptions,
} from "./file_transformer.ts";
import type { TransformFn } from "./file_transformer.ts";
import {
  DiskBuildCache,
  type FsRoute,
  MemoryBuildCache,
} from "./dev_build_cache.ts";
import { BUILD_ID } from "@freshpack/build-id";
import { devErrorOverlay } from "./middlewares/error_overlay/middleware.tsx";
import { automaticWorkspaceFolders } from "./middlewares/automatic_workspace_folders.ts";
import { parseDirPath } from "../config.ts";
import { pathToExportName } from "../utils.ts";
import { crawlFsItem } from "./fs_crawl.ts";
import { TEST_FILE_PATTERN } from "../constants.ts";

export interface BuildOptions {
  /**
   * This sets the target environment for the generated code. Newer
   * language constructs will be transformed to match the specified
   * support range. See https://esbuild.github.io/api/#target
   * @default {"es2022"}
   */
  target?: string | string[];
  /**
   * The root directory of the Fresh project.
   *
   * Other paths, such as `build.outDir`, `staticDir`, and `fsRoutes()`
   * are resolved relative to this directory.
   * @default Deno.cwd()
   */
  root?: string;
  /**
   * The directory to write generated files to when `dev.ts build` is run.
   *
   * This can be an absolute path, a file URL or a relative path.
   * Relative paths are resolved against the `root` option.
   * @default "_fresh"
   */
  outDir?: string;
  /**
   * The directory (or directories) to serve static files from.
   *
   * Each entry can be an absolute path, a file URL or a relative path.
   * Relative paths are resolved against the `root` option.
   * When multiple directories are specified, they are searched in order
   * and the first match wins.
   * @default "static"
   */
  staticDir?: string | string[];
  /**
   * The directory which contains islands.
   *
   * This can be an absolute path, a file URL or a relative path.
   * Relative paths are resolved against the `root` option.
   * @default "islands"
   */
  islandDir?: string;
  /**
   * The directory which contains routes.
   *
   * This can be an absolute path, a file URL or a relative path.
   * Relative paths are resolved against the `root` option.
   * @default "routes"
   */
  routeDir?: string;
  /**
   * The entrypoint for your server.
   *
   * This can be an absolute path, a file URL or a relative path.
   * Relative paths are resolved against the `root` option.
   * @default "main.ts"
   */
  serverEntry?: string;
  /**
   * File paths which should be ignored when crawling the file system.
   */
  ignore?: RegExp[];

  /**
   * Glob patterns for static files that should use content-hash caching
   * instead of BUILD_ID. When a file matches, `asset()` uses its content
   * hash as the cache-bust key so the URL only changes when the file
   * content changes — surviving deploys unchanged.
   *
   * @example ["**\/*.wasm", "**\/*.bin"]
   */
  contentAddressedStatic?: string[];
}

/**
 * The final resolved Builder configuration.
 */
export type ResolvedBuildConfig =
  & Required<
    Omit<BuildOptions, "staticDir" | "contentAddressedStatic">
  >
  & {
    /** Always normalized to an array of absolute paths. */
    staticDir: string[];
    mode: "development" | "production";
    buildId: string;
    contentAddressedStatic: string[];
  };

// deno-lint-ignore no-explicit-any
export class Builder<State = any> {
  #transformer: FileTransformer;
  config: ResolvedBuildConfig;
  #islandSpecifiers = new Set<string>();
  #fsRoutes: FsRoute<State>;
  #ready = Promise.withResolvers<void>();

  constructor(options?: BuildOptions) {
    const root = parseDirPath(options?.root ?? ".", Deno.cwd());
    const serverEntry = parseDirPath(options?.serverEntry ?? "main.ts", root);
    const outDir = parseDirPath(options?.outDir ?? "_fresh", root);
    const rawStaticDir = options?.staticDir ?? "static";
    const staticDir =
      (Array.isArray(rawStaticDir) ? rawStaticDir : [rawStaticDir])
        .map((d) => parseDirPath(d, root));
    const islandDir = parseDirPath(options?.islandDir ?? "islands", root);
    const routeDir = parseDirPath(options?.routeDir ?? "routes", root);

    this.#fsRoutes = { dir: routeDir, files: [], id: "default" };

    this.#transformer = new FileTransformer(fsAdapter, root);

    this.config = {
      serverEntry,
      target: options?.target ?? ["chrome99", "firefox99", "safari15"],
      root,
      outDir,
      staticDir,
      islandDir,
      routeDir,
      ignore: options?.ignore ?? [TEST_FILE_PATTERN],
      mode: "production",
      buildId: BUILD_ID,
      contentAddressedStatic: options?.contentAddressedStatic ?? [],
    };
  }

  registerIsland(specifier: string): void {
    this.#islandSpecifiers.add(specifier);
  }

  onTransformStaticFile(
    options: OnTransformOptions,
    callback: TransformFn,
  ): void {
    this.#transformer.onTransform(options, callback);
  }

  async listen(
    importApp: () => Promise<{ app: App<State> } | App<State>>,
    options: ListenOptions = {},
  ): Promise<void> {
    this.config.mode = "development";

    await this.#crawlFsItems();

    let app = await importApp();
    if (!(app instanceof App) && "app" in app) {
      app = app.app;
    }

    const buildCache = new MemoryBuildCache<State>(
      this.config,
      this.#fsRoutes,
      this.#transformer,
    );

    await buildCache.prepare();

    app.config.root = this.config.root;
    app.config.mode = "development";
    setBuildCache(app, buildCache, "development");

    const appHandler = app.handler();

    // Store original basePath for display purposes
    const originalBasePath = app.config.basePath;

    const devConfig = { ...app.config, basePath: "" };
    const devApp = new App<State>(devConfig)
      .use(liveReload())
      .use(devErrorOverlay())
      .use(automaticWorkspaceFolders(this.config.root))
      // Wait for islands to be ready
      .use(async (ctx) => {
        await this.#ready.promise;
        return ctx.next();
      })
      .all("*", (ctx) => appHandler(ctx.req, ctx.info));

    devApp.config.root = this.config.root;
    devApp.config.mode = "development";

    setBuildCache(devApp, buildCache, "development");

    // Boot in parallel to spin up the server quicker. We'll hold
    // requests until the required assets are processed.
    await Promise.all([
      devApp.listen({
        ...options,
        onListen: options.onListen ??
          createOnListen(originalBasePath, options),
      }),
      // TODO: build
      // this.#build(buildCache, true),
    ]);
    return;
  }

  /**
   * Build optimized assets for your app. By default this will create
   * a production build.
   *
   * This can also be used for testing to apply a snapshot to a particular
   * {@linkcode App} instance.
   *
   * @example Testing
   * ```ts
   * const builder = new Builder();
   * const applySnapshot = await builder.build({ snapshot: "memory" });
   *
   * Deno.test("My Test", () => {
   *   const app = new App()
   *     .get("/", () => new Response("hello"))
   *
   *   applySnapshot(app)
   *
   *   // ... your usual testing
   * })
   * ```
   * @param options
   * @returns Apply a snapshot to a particular {@linkcode App} instance.
   */
  async build(
    options?: {
      mode?: ResolvedBuildConfig["mode"];
      snapshot?: "disk" | "memory";
    },
  ): Promise<(app: App<State>) => void> {
    this.config.mode = options?.mode ?? "production";

    await this.#crawlFsItems();

    const buildCache = options?.snapshot === "memory"
      ? new MemoryBuildCache(
        this.config,
        this.#fsRoutes,
        this.#transformer,
      )
      : new DiskBuildCache(
        this.config,
        this.#fsRoutes,
        this.#transformer,
      );

    // await this.#build(buildCache, this.config.mode === "development");
    // TODO: build
    await buildCache.prepare();

    return (app) => {
      setBuildCache(app, buildCache, app.config.mode);
    };
  }

  async #crawlFsItems() {
    const { islands, routes } = await crawlFsItem(
      {
        islandDir: this.config.islandDir,
        routeDir: this.config.routeDir,
        ignore: this.config.ignore,
      },
    );

    for (let i = 0; i < islands.length; i++) {
      this.registerIsland(islands[i]);
    }

    this.#fsRoutes.files = routes;
  }
}

export function specToName(spec: string): string {
  if (/^(https?:|file:)/.test(spec)) {
    const url = new URL(spec);
    if (url.pathname === "/") {
      return pathToExportName(url.hostname);
    }

    const idx = spec.lastIndexOf("/");
    return pathToExportName(spec.slice(idx + 1));
  } else if (spec.startsWith("jsr:")) {
    const match = spec.match(
      /jsr:@([^/]+)\/([^@/]+)(@[\^~]?\d+\.\d+\.\d+([^/]+)?)?(\/.*)?$/,
    )!;
    if (match[5] === undefined) {
      return pathToExportName(`${match[1]}_${match[2]}`);
    }

    return pathToExportName(match[5]);
  } else if (spec.startsWith("npm:")) {
    const match = spec.match(
      /npm:(@([^/]+)\/([^@/]+)|[^@/]+)(@[\^~]?\d+\.\d+\.\d+([^/]+)?)?(\/.*)?$/,
    )!;

    if (match[6] === undefined) {
      if (match[2] === undefined) {
        return pathToExportName(match[1]);
      }
      return pathToExportName(`${match[2]}_${match[3]}`);
    }

    return pathToExportName(match[6]);
  }

  const match = spec.match(/^(@([^/]+)\/([^@/]+)|[^@/]+)(\/.*)?$/);
  if (match !== null) {
    if (match[4] === undefined) {
      if (match[2] !== undefined) {
        return pathToExportName(`${match[2]}_${match[3]}`);
      }

      return pathToExportName(match[1]);
    }

    return pathToExportName(match[4]);
  }

  return pathToExportName(spec);
}
