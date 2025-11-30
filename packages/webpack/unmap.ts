import type * as Webpack from "webpack";
import { assert } from "@std/assert";

interface UnmapCompilation extends Webpack.Compilation {
  unmapping: Record<string, string>;
}

export function assertUnmapCompilation(
  compilation: Webpack.Compilation,
): asserts compilation is UnmapCompilation {
  assert(
    "unmapping" in compilation,
    "missing fresh data in compilation, did you add WebpackFreshEntries plugin?",
  );
}
export class UnmapPlugin {
  apply(compiler: Webpack.Compiler) {
    const mappings = new Map<
      string,
      { name: string; module: Webpack.Module; loc: Webpack.Dependency["loc"] }
    >();
    const nameToRequest = new Map<string, string>();
    const nameToAsset = new Map<string, string>();

    compiler.hooks.compilation.tap(
      UnmapPlugin.name,
      (compilation, { normalModuleFactory }) => {
        normalModuleFactory.hooks.parser.for("javascript/auto").tap(
          UnmapPlugin.name,
          (parser) => {
            parser.hooks.call.for("unmap").tap(UnmapPlugin.name, (expr) => {
              const error = (msg: string) => {
                const err = new compiler.webpack.WebpackError(msg);
                err.loc = expr.loc!;
                parser.state.module.addError(
                  err,
                );
              };
              if (expr.arguments.length !== 2) {
                return error(`unmap requires (name, new URL()) arguments`);
              }

              const nameArg = parser.evaluateExpression(expr.arguments[0]);
              if (!nameArg.isString()) {
                return error(
                  `first argument for unmap should be a static string`,
                );
              }

              const urlExpr = expr.arguments[1];
              if (
                urlExpr.type !== "NewExpression" ||
                urlExpr.callee.type !== "Identifier" ||
                urlExpr.callee.name !== "URL"
              ) {
                return error(
                  `second argument for unmap should be new URL() expression`,
                );
              }
              const key = `${parser.state.module.identifier()}:${
                urlExpr.range![0]
              }`;
              mappings.set(key, {
                name: nameArg.string!,
                module: parser.state.module,
                loc: expr.loc!,
              });
            });
          },
        );

        compilation.hooks.afterOptimizeModules.tap(
          UnmapPlugin.name,
          () => {
            for (const module of compilation.modules) {
              if (!module.dependencies) return;

              for (const dep of module.dependencies) {
                if (dep.constructor.name !== "URLDependency") continue;
                const dep_ = dep as unknown as { outerRange: [number, number] };

                const key = `${module.identifier()}:${dep_.outerRange[0]}`;
                const name = mappings.get(key);

                if (!name) continue;

                const error = (msg: string) => {
                  const err = new compiler.webpack.WebpackError(
                    msg,
                  );
                  err.module = name.module;
                  err.loc = name.loc;
                  compilation.errors.push(err);
                };

                const connection = compilation.moduleGraph.getConnection(
                  dep,
                );
                if (!connection || !connection.module) {
                  error("unable to find connection for url dependency");
                  continue;
                }
                const mod = connection.module as {
                  resource?: string;
                  userRequest?: string;
                };
                const request = mod.resource ?? mod.userRequest;
                if (!request) {
                  error(`unable to resolve unmap request`);
                  continue;
                }

                {
                  const oldV = nameToRequest.get(name.name);
                  if (oldV !== undefined && oldV !== request) {
                    error(
                      `ResolutionConflict: unmap(${
                        JSON.stringify(name.name)
                      }, ${
                        JSON.stringify(request)
                      }) was previously resolved to ${oldV}, use a different unmapping`,
                    );
                    continue;
                  }
                }
                nameToRequest.set(name.name, request);
              }
            }
          },
        );
        compilation.hooks.processAssets.tap(UnmapPlugin.name, (assets) => {
          for (const [name, request] of nameToRequest.entries()) {
            for (const [assetName, _asset] of Object.entries(assets)) {
              const info = compilation.assetsInfo.get(assetName);
              if (
                info?.sourceFilename && request.endsWith(info.sourceFilename)
              ) {
                nameToAsset.set(name, assetName);
                break;
              }
            }
          }
          const unmapping = Object.fromEntries(nameToAsset);
          const json = JSON.stringify(unmapping);
          compilation.emitAsset(
            "mapped.json",
            new compiler.webpack.sources.RawSource(json),
          );
          (compilation as UnmapCompilation).unmapping = unmapping;
        });
      },
    );
  }
}
