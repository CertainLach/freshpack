/* FIXME: Typings are awful in this file, the port was very crude */

import type Webpack from "webpack";
import {
  injectRefreshFunctions,
  matcherOptions,
  NAME,
  prefreshUtils,
} from "./utils/constants.ts";
import { createPrefreshRuntimeModule } from "./utils/Runtime.ts";
import { defineRequire } from "../requireHook.ts";

type Options = {
  overlay?: {
    module: string;
  };
  entryOptions?: string | Webpack.EntryOptions;
};

const internalPrefreshLoader = defineRequire(
  "@freshpack/webpack/internal-prefresh-loader",
  await import("./loader/index.ts"),
);

export class DenoPreactRefreshPlugin {
  matcher: (str: string) => boolean = () => false;
  constructor(public options: Options) {}

  webpack5(compiler: Webpack.Compiler) {
    const { RuntimeGlobals } = compiler.webpack;
    const PrefreshRuntimeModule = createPrefreshRuntimeModule(
      compiler.webpack,
    );
    compiler.hooks.compilation.tap(
      NAME,
      (compilation, { normalModuleFactory }) => {
        if (compilation.compiler !== compiler) {
          return;
        }

        injectRefreshFunctions(compilation);

        compilation.hooks.additionalTreeRuntimeRequirements.tap(
          NAME,
          (chunk, runtimeRequirements) => {
            runtimeRequirements.add(RuntimeGlobals.interceptModuleExecution);
            compilation.addRuntimeModule(chunk, new PrefreshRuntimeModule());
          },
        );

        normalModuleFactory.hooks.afterResolve.tap(
          NAME,
          ({ createData: data }) => {
            if (
              this.matcher(data.resource!) &&
              !data.resource!.includes("@prefresh") &&
              !data.resource!.includes("/prefresh-forked/loader/") &&
              !data.resource!.includes("/prefresh-forked/utils/")
            ) {
              data.loaders!.unshift({
                loader: internalPrefreshLoader,
                options: undefined,
              });
            }
          },
        );
      },
    );
  }

  apply(compiler: Webpack.Compiler) {
    if (
      compiler.options.mode === "production"
    ) {
      return;
    }

    const provide = {
      [prefreshUtils]: import.meta.resolve("./utils/prefresh.ts"),
    };

    if (this.options.overlay) {
      (provide as any).__prefresh_errors__ = import.meta.resolve(
        this.options.overlay.module,
      );
    }

    this.matcher = compiler.webpack.ModuleFilenameHelpers.matchObject.bind(
      undefined,
      matcherOptions,
    );
    const providePlugin = new compiler.webpack.ProvidePlugin(provide);
    providePlugin.apply(compiler);
    const dependency = compiler.webpack.EntryPlugin.createDependency(
      "@prefresh/core",
      { name: "@prefresh/core" },
    );
    compiler.hooks.make.tapAsync(NAME, (compilation, callback) => {
      compilation.addEntry(
        compiler.context,
        dependency,
        this.options.entryOptions ?? {},
        callback as any,
      );
    });

    this.webpack5(compiler);
  }
}
