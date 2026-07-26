import Webpack, { type Compiler } from "webpack";

type JavascriptParser = Webpack.javascript.JavascriptParser;

const NAME = "DenoEnvPlugin";

const PARSER_TYPES = [
  "javascript/auto",
  "javascript/dynamic",
  "javascript/esm",
] as const;

export type DenoEnvOptions = {
  allowedEnv?: (string | RegExp)[];
};

/**
 * DenoEnvPlugin replaces calls to `Deno.env.get` with a constant expression of environment variable name.
 */
export class DenoEnvPlugin {
  #allowed: (string | RegExp)[];
  constructor(opts: DenoEnvOptions = {}) {
    this.#allowed = [
      ...opts.allowedEnv ?? [],
      /^FRESH_PUBLIC_/,
      "NODE_ENV",
      "DENO_DEPLOYMENT_ID",
      "GITHUB_SHA",
      "CI_COMMIT_SHA",
      "CI",
    ];
  }
  #isAllowed(name: string) {
    return this.#allowed.some((allowed) =>
      allowed instanceof RegExp ? allowed.test(name) : allowed === name
    );
  }
  #value(name: string, compiler: Compiler) {
    if (name === "NODE_ENV") {
      const mode = compiler.options.mode;
      if (mode !== undefined && mode !== "none") return mode;
    }
    return Deno.env.get(name);
  }
  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      NAME,
      (_compilation, { normalModuleFactory }) => {
        const handler = (parser: JavascriptParser) => {
          parser.hooks.call.for("Deno.env.get").tap(NAME, (expr) => {
            const [arg] = expr.arguments;
            if (
              expr.arguments.length !== 1 || arg.type !== "Literal" ||
              typeof arg.value !== "string"
            ) {
              return;
            }
            const name = arg.value;
            if (!this.#isAllowed(name)) {
              throw new Error(`Env var is not allowed in bundling: ${name}`);
            }
            const value = this.#value(name, compiler);
            const dep = new Webpack.dependencies.ConstDependency(
              value === undefined ? "undefined" : JSON.stringify(value),
              expr.range!,
            );
            if (expr.loc) dep.loc = expr.loc;
            parser.state.module.addPresentationalDependency(dep);
            return true;
          });
        };
        for (const type of PARSER_TYPES) {
          normalModuleFactory.hooks.parser.for(type).tap(NAME, handler);
        }
      },
    );
  }
}
