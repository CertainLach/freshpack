import type Webpack from "webpack";

export const prefreshUtils = "__prefresh_utils__";
export const NAME = "PrefreshWebpackPlugin";

export const matcherOptions = {
  include: /\.([jt]sx?)$/,
  exclude: /node_modules|\/deno\/npm\//,
};

export function injectRefreshFunctions(compilation: Webpack.Compilation) {
  const { Template } = compilation.compiler.webpack;
  const hookVars = compilation.mainTemplate.hooks.localVars;

  hookVars.tap(
    "ReactFreshWebpackPlugin",
    (source) =>
      Template.asString([
        source,
        "",
        "// noop fns to prevent runtime errors during initialization",
        'if (typeof self !== "undefined") {',
        Template.indent("self.$RefreshReg$ = function () {};"),
        Template.indent("self.$RefreshSig$ = function () {"),
        Template.indent(Template.indent("return function (type) {")),
        Template.indent(Template.indent(Template.indent("return type;"))),
        Template.indent(Template.indent("};")),
        Template.indent("};"),
        "}",
      ]),
  );
}
