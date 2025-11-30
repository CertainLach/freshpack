import type Webpack from "webpack";

const runtimeText = await fetch(new URL("./runtime.js", import.meta.url)).then(
  (res) => res.text(),
);

export default function RefreshHotLoader(
  this: any,
  source: Webpack.sources.SourceMapSource,
  inputSourceMap: Webpack.sources.SourceMapSource["source"],
) {
  this.callback(null, source + "\n\n" + runtimeText, inputSourceMap);
}
