import Webpack from "webpack";
import {
  injectRefreshFunctions,
  matcherOptions,
  NAME,
  prefreshUtils,
} from "./utils/constants.ts";
import { PrefreshRuntimeModule } from "./utils/Runtime.ts";

type Options = {
  overlay?: {
    module: string;
  };
  entryOptions: string | Webpack.EntryOptions;
};

export class DenoPreactRefreshPlugin {
  matcher;
  constructor(public options: Options) {
    this.matcher = Webpack.ModuleFilenameHelpers.matchObject.bind(
      undefined,
      matcherOptions,
    );
  }

  webpack5(
    compiler: Webpack.Compiler,
    RuntimeGlobals: typeof Webpack.RuntimeGlobals,
  ) {
    // const createPrefreshRuntimeModule = require("./utils/Runtime.ts");
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
              this.matcher(data.resource) &&
              !data.resource.includes("@prefresh") &&
              !data.resource.includes("/prefresh-forked/loader/") &&
              !data.resource.includes("/prefresh-forked/utils/")
            ) {
              data.loaders.unshift({
                loader: import.meta.resolve("./loader/index.ts").replace(
                  /^file:/,
                  "",
                ),
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
      [prefreshUtils]: import.meta.resolve("./utils/prefresh"),
    };

    if (this.options.overlay) {
      (provide as any).__prefresh_errors__ = import.meta.resolve(
        this.options.overlay.module,
      );
    }

    const providePlugin = new Webpack.ProvidePlugin(provide);
    providePlugin.apply(compiler);
    const dependency = Webpack.EntryPlugin.createDependency(
      "@prefresh/core",
      { name: "@prefresh/core" },
    );
    compiler.hooks.make.tapAsync(NAME, (compilation, callback) => {
      compilation.addEntry(
        compiler.context,
        dependency,
        this.options.entryOptions,
        callback,
      );
    });

    this.webpack5(
      compiler,
      compiler.webpack
        ? compiler.webpack.RuntimeGlobals
        : Webpack.RuntimeGlobals,
    );
  }
}
