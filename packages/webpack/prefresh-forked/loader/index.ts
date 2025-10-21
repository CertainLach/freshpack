import Webpack from "webpack";

const moduleRuntime = Deno.readTextFileSync(new URL('runtime.js', import.meta.url));

export default function RefreshHotLoader(
  source,
  inputSourceMap,
) {
  this.callback(null, source + "\n\n" + moduleRuntime, inputSourceMap);
}
