import type { Compiler } from "webpack";

const NAME = "ImportMetaResolveAssetPlugin";

type Range = [number, number];

type ResolveDependency = {
  outerRange: Range;
  relative: boolean;
};

type Source = {
  replace(start: number, end: number, content: string): void;
};

type Module = {
  getSourceTypes(): Set<string>;
};

type TemplateContext = {
  moduleGraph: {
    getModule(dep: unknown): Module | null;
    getConnection(
      dep: unknown,
    ): { isTargetActive(runtime: unknown): boolean } | undefined;
  };
  codeGenerationResults: {
    has(module: Module, runtime: unknown): boolean;
    getData(module: Module, runtime: unknown, key: string): unknown;
  };
  runtimeRequirements: Set<string>;
  runtime: unknown;
};

type Template = {
  apply(dep: unknown, source: Source, ctx: TemplateContext): void;
};

type Templates = {
  get(ctor: unknown): Template | undefined;
  set(ctor: unknown, template: Template): void;
};

export class ImportMetaResolveAssetPlugin {
  apply(compiler: Compiler) {
    const { RuntimeGlobals } = compiler.webpack;
    compiler.hooks.compilation.tap(
      { name: NAME, stage: 100 },
      (compilation) => {
        const ctor = [...compilation.dependencyFactories.keys()].find((c) =>
          c.name === "ImportMetaResolveDependency"
        );
        if (!ctor) return;
        const templates = compilation
          .dependencyTemplates as unknown as Templates;
        const original = templates.get(ctor);
        if (!original) return;
        compilation.hooks.succeedModule.tap(NAME, (module) => {
          for (const dep of module.dependencies) {
            if (dep.constructor === ctor) {
              module.addCodeGenerationDependency(dep);
            }
          }
        });
        templates.set(ctor, {
          apply(dep, source, ctx) {
            const { outerRange, relative } = dep as ResolveDependency;
            const module = ctx.moduleGraph.getModule(dep);
            const active = ctx.moduleGraph.getConnection(dep)
              ?.isTargetActive(ctx.runtime) ?? true;
            const filename = active && module &&
                !module.getSourceTypes().has("javascript") &&
                ctx.codeGenerationResults.has(module, ctx.runtime)
              ? ctx.codeGenerationResults.getData(
                module,
                ctx.runtime,
                "filename",
              )
              : undefined;
            if (typeof filename !== "string") {
              original.apply(dep, source, ctx);
              return;
            }
            ctx.runtimeRequirements.add(RuntimeGlobals.publicPath);
            const url = `${RuntimeGlobals.publicPath} + ${
              JSON.stringify(filename)
            }`;
            if (relative) {
              ctx.runtimeRequirements.add(RuntimeGlobals.relativeUrl);
              source.replace(
                outerRange[0],
                outerRange[1] - 1,
                `(new ${RuntimeGlobals.relativeUrl}(/* asset import */ ${url})).href`,
              );
            } else {
              ctx.runtimeRequirements.add(RuntimeGlobals.baseURI);
              source.replace(
                outerRange[0],
                outerRange[1] - 1,
                `(new URL(/* asset import */ ${url}, ${RuntimeGlobals.baseURI})).href`,
              );
            }
          },
        });
      },
    );
  }
}
