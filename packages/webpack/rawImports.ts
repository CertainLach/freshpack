import type { Compiler } from "webpack";
import { defineRequire } from "./requireHook.ts";

const NAME = "RawImportsPlugin";

const internalRawBytesLoader = defineRequire(
  "@freshpack/webpack/internal-raw-bytes-loader",
  await import("./rawBytesLoader.ts"),
);

type ModuleFactory = {
  getParser(type: string): unknown;
  getGenerator(type: string): unknown;
};

type CreateData = {
  type: string;
  settings: { type?: string };
  parser?: unknown;
  parserOptions?: unknown;
  generator?: unknown;
  generatorOptions?: unknown;
  loaders?: {
    loader: string;
    options: unknown;
    ident: string | null;
    type: string | null;
  }[];
};

export interface RawImportsOptions {
  /**
   * "resource" (default) emits a bytes import as a standalone asset fetched at runtime,
   * "inline" embeds it into the importing chunk as base64.
   */
  bytes?: "resource" | "inline";
}

function setModuleType(
  factory: ModuleFactory,
  data: CreateData,
  type: string,
) {
  data.type = type;
  data.settings.type = type;
  data.parser = factory.getParser(type);
  data.parserOptions = undefined;
  data.generator = factory.getGenerator(type);
  data.generatorOptions = undefined;
}

export class RawImportsPlugin {
  constructor(public options: RawImportsOptions = {}) {}

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      NAME,
      (_compilation, { normalModuleFactory }) => {
        normalModuleFactory.hooks.afterResolve.tap(NAME, (resolveData) => {
          const attributes = (resolveData.dependencies[0] as undefined | {
            attributes?: { type?: string };
          })?.attributes;
          const data = resolveData.createData as unknown as CreateData;
          if (attributes?.type === "text") {
            setModuleType(normalModuleFactory, data, "asset/source");
            data.loaders = [];
          } else if (attributes?.type === "bytes") {
            if (this.options.bytes === "inline") {
              setModuleType(normalModuleFactory, data, "asset/bytes");
              data.loaders = [];
            } else {
              setModuleType(normalModuleFactory, data, "javascript/esm");
              data.loaders = [{
                loader: internalRawBytesLoader,
                options: {},
                ident: null,
                type: null,
              }];
            }
          }
        });
      },
    );
  }
}
