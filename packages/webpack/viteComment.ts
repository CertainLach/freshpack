import type Webpack from "webpack";
import type { Compiler } from "webpack";

type JavascriptParser = Webpack.javascript.JavascriptParser;

const NAME = "ViteIgnorePlugin";

const PARSER_TYPES = [
  "javascript/auto",
  "javascript/dynamic",
  "javascript/esm",
] as const;

/**
 * ViteIgnorePlugin skips parsing of `import` calls that contain `@vite-inore` in inline comment, similarly
 * to webpack built-in `webpackIgnore: true` annotation
 */
export class ViteIgnorePlugin {
  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      NAME,
      (_compilation, { normalModuleFactory }) => {
        const handler = (parser: JavascriptParser) => {
          parser.hooks.importCall.tap({ name: NAME, stage: -10 }, (expr) => {
            const ignored = parser.getComments([
              expr.range![0],
              expr.source.range![1],
            ]).some((comment) =>
              comment.type === "Block" &&
              comment.value.includes("@vite-ignore")
            );
            if (ignored) return false;
          });
        };
        for (const type of PARSER_TYPES) {
          normalModuleFactory.hooks.parser.for(type).tap(NAME, handler);
        }
      },
    );
  }
}
