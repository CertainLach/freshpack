import Webpack from "webpack";

export const prefreshUtils = "__prefresh_utils__";
export const NAME = "PrefreshWebpackPlugin";

export const matcherOptions = {
  include: /\.([jt]sx?)$/,
  exclude: /node_modules|\/deno\/npm\//,
};

export function injectRefreshFunctions(compilation: Webpack.Compilation) {
  const hookVars = compilation.mainTemplate.hooks.localVars;

  hookVars.tap(
    "ReactFreshWebpackPlugin",
    (source) =>
      Webpack.Template.asString([
        source,
        "",
        "// noop fns to prevent runtime errors during initialization",
        'if (typeof self !== "undefined") {',
        Webpack.Template.indent("self.$RefreshReg$ = function () {};"),
        Webpack.Template.indent("self.$RefreshSig$ = function () {"),
        Webpack.Template.indent(
          Webpack.Template.indent("return function (type) {"),
        ),
        Webpack.Template.indent(
          Webpack.Template.indent(Webpack.Template.indent("return type;")),
        ),
        Webpack.Template.indent(Webpack.Template.indent("};")),
        Webpack.Template.indent("};"),
        "}",
      ]),
  );
}
