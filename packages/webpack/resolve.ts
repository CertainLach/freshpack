import {
  type Loader,
  RequestedModuleType,
  ResolutionMode,
  Workspace,
  type WorkspaceOptions,
} from "@deno/loader";
import { assert, unreachable } from "@std/assert";
import Webpack, { type Compiler } from "webpack";
import { Buffer } from "node:buffer";
import {
  ensureFileUrl,
  ensureModPath,
  stripFileUrl,
} from "./util.ts";
import { dirname } from "@std/path";

function resolverSpan(
  logSuccess: boolean | undefined,
  name: string,
  ...args: unknown[]
) {
  let isResolved: undefined | unknown[];
  let timeoutId: number | undefined = setTimeout(() => {
    console.error("[RESOLVE]", "possibly stuck at", name, ...args);
    if (isResolved !== undefined) {
      console.error("         ", "...but it was resolved:", ...isResolved);
    }
  }, 5000);
  const cancelStuck = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };
  let postponed = false;
  return {
    simplify(...newArgs: unknown[]) {
      args = newArgs;
    },
    errored(e: unknown, ...err: unknown[]) {
      cancelStuck();
      console.error("[RESOLVE]", "errored", name, ...args, "=>", e, ...err);
    },
    resolved(...out: unknown[]) {
      cancelStuck();
      if (isResolved === undefined) {
        isResolved = out;
        if (logSuccess) {
          console.info("[RESOLVE]", name, ...args, "=>", ...out);
        }
      } else {
        console.error(
          "[RESOLVE]",
          "resolved twice",
          name,
          ...args,
          "=>",
          ...out,
        );
        console.error("         ", "...previously resolved to:", ...isResolved);
      }
    },
    [Symbol.dispose]() {
      if (postponed) return;
      cancelStuck();
      if (isResolved === undefined) {
        console.error("[RESOLVE]", "missing resolved() call!", name, ...args);
      }
    },
    postpone() {
      postponed = true;
    },
  };
}

async function simpleDenoResolve(
  loader: Loader,
  issuer: string,
  request: string,
  esm: boolean,
) {
  let resolution: string | undefined;
  if (request.startsWith("/")) {
    resolution = `file://${request}`;
  } else if (request === ".") {
    console.log("Dot request!", request, issuer);
    resolution = `file://${dirname(issuer)}`;
  } else {
    resolution = await loader.resolve(
      request,
      issuer,
      // TODO: require?
      esm ? ResolutionMode.Import : ResolutionMode.Require,
    );
  }
  if (resolution.startsWith("node:")) {
    // PASS: Fallback or external
  } else if (
    resolution.startsWith("https:")
  ) {
    // PASS: https loader
  } else {
    resolution = stripFileUrl(resolution);
  }
  return resolution;
}

class FixupResolvePlugin {
  apply(resolver: Webpack.Resolver) {
    const resolved = resolver.getHook("resolved");
    for (const hook of ["resolve", "internal-resolve"]) {
      resolver.getHook(hook).tapAsync({
        name: "Ignore https requests",
        stage: -100000,
      }, (req, ctx, cb) => {
        if (
          req.path && req.path.startsWith("https://") && req.request === "." ||
          req.request && req.request.startsWith("https://")
        ) {
          return resolver.doResolve(resolved, req, "context resolve", ctx, cb);
        }
        // console.log("DIR RESOLVE!!!", req);
        return cb(null);
        // return cb(null, ...args);
      });
    }
    // resolver.hooks.result.tap({
    //   name: "resolvers in https requests",
    //   stage: -100000,
    // }, (req, ctx) => {
    //   console.log("post resolve", req);
    //   return;
    // });
    // resolver.hooks.resolve.tap({ name: "Fixup" }, (req) => {
    //   console.log('fixup resolver', req.request);
    //   return req;
    // });
  }
}

class DenoResolvePlugin {
  constructor(
    public jsr: DenoLoaderPlugin,
  ) {
  }
  apply(resolver: Webpack.Resolver) {
    // console.log("HOOKS", resolver.hooks);
    const source = resolver.getHook("resolve");
    const target = resolver.getHook("resolved");
    source.tapAsync(
      { name: "Deno" },
      async (request, ctx, cb) => {
        using span = resolverSpan(
          this.jsr.opts.debug,
          "deno resolver",
          request,
          ctx,
        );
        try {
          const loader = await this.jsr.loader;
          let requestIssuer: string | undefined;
          if (request.context && "issuer" in request.context) {
            const issuer = request.context.issuer;
            assert(
              typeof issuer === "string" || issuer === null,
              "invalid context issuer",
            );
            if (issuer !== "" && issuer !== null) {
              requestIssuer = issuer;
            }
          }
          if (requestIssuer === undefined && request.path) {
            requestIssuer = ensureModPath(request.path);
          }
          assert(
            requestIssuer !== undefined,
            "failed to determine requestIssuer",
          );
          const requestRequest = request.request;
          assert(
            requestRequest !== undefined,
            "failed to determine requestRequest",
          );
          span.simplify(requestIssuer, requestRequest);
          const resolution = await simpleDenoResolve(
            loader,
            requestIssuer,
            requestRequest,
            request.module ?? true,
          );
          return resolver.doResolve(
            target,
            Object.assign({}, request, {
              path: resolution,
              request: undefined,
            }),
            `resolved by deno ${request.request} (from ${request.path})`,
            ctx,
            (err, result) => {
              span.resolved("doResolve result", resolution, err, result);
              if (err !== undefined || result !== undefined) {
                return cb(err, result);
              }
              cb(null, null);
            },
          );
        } catch (e: unknown) {
          span.errored(e, request, ctx);
          cb(e as Error, null);
        }
      },
    );
  }
}

type ResourceData = {
  path?: string;
  context?: string;
  resource?: string;
  query?: string;
  fragment?: string;
  type?: string;
  data: { path?: string | false; query?: string };
};
async function fillResourceData(data: ResourceData, loader: Loader, url: URL) {
  (data as any).__resolvedByFreshpack = { data, url, loaded: undefined };
  if (url.protocol === "file:") {
    data.resource = url.pathname;
    data.path = url.pathname;
    data.data.path = url.pathname;
    data.context = dirname(url.pathname);
  } else {
    const loaded = await loader.load(url.href, RequestedModuleType.Default);
    (data as any).__resolvedByFreshpack.loaded = loaded;
    data.resource = loaded.specifier;
    data.path = loaded.specifier;
    data.data.path = loaded.specifier;
    data.context = new URL(".", url).href.slice(0, -1);
  }
  data.query = url.search;
  data.data.query = url.search;
  data.fragment = url.hash;

  // data.type = "application/javascript";
}
function breakResourceData(data: ResourceData) {
  data.path = "error";
  data.context = "error";
  data.resource = "error";
}

function ensurePluginList(
  resolver: Record<string, unknown>,
  list: string,
  append: unknown,
) {
  if (resolver[list] === undefined) {
    resolver[list] = [];
  }
  assert(Array.isArray(resolver[list]));
  resolver[list].push(append);
}

export class DenoLoaderPlugin {
  workspace: Workspace;
  #loader?: Promise<Loader>;
  get loader(): Promise<Loader> {
    return (this.#loader ??= this.workspace.createLoader());
  }
  constructor(
    public opts: WorkspaceOptions,
  ) {
    opts.noTranspile = false;
    opts.preserveJsx = true;
    opts.platform = "browser";
    this.workspace = new Workspace(opts);
  }
  apply(compiler: Compiler) {
    if (compiler.options.resolve.plugins === undefined) {
      compiler.options.resolve.plugins = [];
    }
    assert(Array.isArray(compiler.options.resolve.plugins));
    compiler.options.resolve.plugins.push(new FixupResolvePlugin());

    if (compiler.options.resolveLoader.plugins === undefined) {
      compiler.options.resolveLoader.plugins = [];
    }
    assert(Array.isArray(compiler.options.resolveLoader.plugins));
    compiler.options.resolveLoader.plugins.push(new DenoResolvePlugin(this));

    compiler.options.resolve.modules = [];
    compiler.options.resolve.roots = [];
    compiler.options.resolve.descriptionFiles = [];
    compiler.options.resolveLoader.modules = [];
    compiler.options.resolveLoader.descriptionFiles = [];

    compiler.options.externalsPresets.web = false;
    compiler.options.externalsPresets.webAsync = false;

    if (!compiler.options.output.enabledLibraryTypes) {
      compiler.options.output.enabledLibraryTypes = [];
    }
    if (!compiler.options.output.enabledLibraryTypes.includes("module")) {
      compiler.options.output.enabledLibraryTypes.push("module");
    }
    compiler.options.output.library = { type: "module" };

    compiler.options.output.module = true;
    compiler.options.experiments.outputModule = true;

    compiler.hooks.compilation.tap(
      "JsrPlugin",
      (compilation, { normalModuleFactory }) => {
        // normalModuleFactory.hooks.afterResolve.tap(
        //   { name: "JsrPlugin", stage: -100000 },
        //   (a) => {
        //     console.log("after resolve", a);
        //   },
        // );
        normalModuleFactory.hooks.beforeResolve.tapPromise(
          "JsrPlugin",
          async (resolveData) => {
            using span = resolverSpan(
              this.opts.debug,
              "jsr beforeResolve",
              resolveData,
            );
            try {
              // try {
              const loader = await this.loader;
              let requestIssuer: string | undefined | null;
              if (resolveData.contextInfo.issuer !== "") {
                requestIssuer = resolveData.contextInfo.issuer;
              }
              if (requestIssuer === undefined || requestIssuer === null) {
                requestIssuer = ensureModPath(resolveData.context);
              }
              assert(
                requestIssuer != undefined,
                "failed to determine request issuer",
              );
              let requestRequest = resolveData.request;
              const dependencyType = resolveData.dependencyType;
              span.simplify({
                requestIssuer,
                requestRequest,
                dependencyType,
              });

              if (dependencyType === "url") {
                requestRequest = "./" + requestRequest;
              }
              if (dependencyType === "wasm") {
                return false;
              }

              const resolution = await simpleDenoResolve(
                loader,
                requestIssuer,
                requestRequest,
                true,
              );
              span.resolved(resolution);
              resolveData.request = resolution;
            } catch (e) {
              span.errored(e);
              throw e;
            }
          },
        );

        normalModuleFactory.hooks.resolveForScheme.for("node").tapPromise(
          "JsrPlugin",
          async (resourceData, resolveData) => {
            using span = resolverSpan(
              this.opts.debug,
              "node resolveForScheme",
              resolveData,
            );
          },
        );
        normalModuleFactory.hooks.resolveForScheme.for("jsr").tapPromise(
          "JsrPlugin",
          async (resourceData, resolveData) => {
            using span = resolverSpan(
              this.opts.debug,
              "jsr resolveForScheme",
              resolveData,
            );
            breakResourceData(resourceData);
            unreachable("jsr should be resolved to https by deno resolver");
          },
        );
        normalModuleFactory.hooks.resolveForScheme.for("npm").tapPromise(
          "JsrPlugin",
          async (resourceData, resolveData) => {
            using span = resolverSpan(
              this.opts.debug,
              "npm resolveForScheme",
              resolveData,
            );
            breakResourceData(resourceData);
            unreachable("npm should be resolved to files by deno resolver");
          },
        );
        normalModuleFactory.hooks.resolveForScheme.for("https").tapPromise(
          "JsrPlugin",
          async (resourceData, resolveData) => {
            using span = resolverSpan(
              this.opts.debug,
              "https resolveForScheme",
              resolveData.request,
            );
            const loader = await this.loader;
            // const newResourceData = {...resourceData};
            await fillResourceData(
              resourceData,
              loader,
              new URL(resolveData.request),
            );
            span.resolved("done");
            return true;
          },
        );
        normalModuleFactory.hooks.resolveInScheme.for("https").tapPromise(
          "JsrPlugin",
          async (resourceData, data) => {
            using span = resolverSpan(
              this.opts.debug,
              "https resolveInScheme",
              resourceData,
              data.contextInfo,
              data.request,
            );
            try {
              const loader = await this.loader;
              const requestRequest = data.request;
              if (requestRequest.startsWith("/")) {
                span.resolved("pre-resolved file import", requestRequest);
                await fillResourceData(
                  resourceData,
                  loader,
                  ensureFileUrl(requestRequest),
                );
                return true;
              } else {
                const requestIssuer = data.contextInfo.issuer;
                assert(requestIssuer !== "");
                const resolved = await loader.resolve(
                  requestRequest,
                  requestIssuer,
                  ResolutionMode.Import,
                );
                span.resolved("url resolved", resolved);
                assert(resolved.startsWith("https:"));
                await fillResourceData(resourceData, loader, new URL(resolved));
                return true;
              }
            } catch (e) {
              span.errored(e);
              breakResourceData(resourceData);
            }
          },
        );
        const hooks = Webpack.NormalModule.getCompilationHooks(compilation);

        hooks.readResourceForScheme.for("jsr").tapPromise(
          "JsrPlugin",
          async (resource, module) => {
            using span = resolverSpan(
              this.opts.debug,
              "jsr loadResourceForScheme",
              resource,
            );
            unreachable("jsr should be resolved to https by deno resolver");
          },
        );
        hooks.readResourceForScheme.for("https").tapAsync(
          "JsrPlugin",
          async (resource, module, cb) => {
            using span = resolverSpan(
              this.opts.debug,
              "https readResourceForScheme",
              resource,
              module.type,
            );
            try {
              const loader = await this.loader;
              const loaded = await loader.load(
                resource,
                RequestedModuleType.Default,
              );
              // TODO: Should import assertions be handled somehow?
              span.resolved(loaded);
              cb(null, Buffer.from((loaded as { code: Uint8Array }).code));
            } catch (e) {
              span.errored(e);
              cb(e as Error);
            }
          },
        );
      },
    );
  }
}

// Workaround for https://github.com/webpack/watchpack/pull/226
const origConsoleError = console.error;
console.error = (...args) => {
  if (
    args.length === 1 && typeof args[0] === "string" &&
    args[0].startsWith("Watchpack Error ") &&
    (args[0].includes("ENOTDIR: not a directory, readdir ") ||
      args[0].includes("NotADirectory: Not a directory (os error 20): lstat "))
  ) return;
  origConsoleError(...args);
};
