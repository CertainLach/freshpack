import type Webpack from "webpack";
import runtimeText from "./runtime.js" with { type: "text" };

export default function RefreshHotLoader(
  this: any,
  source: Webpack.sources.SourceMapSource,
  inputSourceMap: Webpack.sources.SourceMapSource["source"],
) {
  this.callback(null, source + "\n\n" + runtimeText, inputSourceMap);
}
