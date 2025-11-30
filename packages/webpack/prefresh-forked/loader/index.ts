import type Webpack from "webpack";

const moduleRuntime = Deno.readTextFileSync(
  new URL("runtime.js", import.meta.url),
);

export default function RefreshHotLoader(
  this: any,
  source: Webpack.sources.SourceMapSource,
  inputSourceMap: Webpack.sources.SourceMapSource["source"],
) {
  this.callback(null, source + "\n\n" + moduleRuntime, inputSourceMap);
}
