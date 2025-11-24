import Webpack from "webpack";

const NAMESPACE = "__PREFRESH__";

const beforeModule = `
self.$RefreshSig$ = function() {
  var status = 'begin';
  var savedType;

  return function(type, key, forceReset, getCustomHooks) {
    if (!savedType) savedType = type;
    status = self.${NAMESPACE}.sign(type || savedType, key, forceReset, getCustomHooks, status);
    return type;
  }
}
`;

export class PrefreshRuntimeModule extends Webpack.RuntimeModule {
  constructor() {
    super("prefresh", 5);
  }

  override generate() {
    const { runtimeTemplate } = this.compilation as any;
    const declare = runtimeTemplate.supportsConst() ? "const" : "var";

    return Webpack.Template.asString([
      `${Webpack.RuntimeGlobals.interceptModuleExecution}.push(${
        runtimeTemplate.basicFunction("options", [
          `${declare} originalFactory = options.factory;`,
          `options.factory = ${
            runtimeTemplate.basicFunction(
              "moduleObject, moduleExports, webpackRequire",
              [
                'if (typeof self !== "undefined") {',
                Webpack.Template.indent([
                  `${declare} prevRefreshReg = self.$RefreshReg$;`,
                  `${declare} prevRefreshSig = self.$RefreshSig$;`,
                  beforeModule,
                  `${declare} reg = ${
                    runtimeTemplate.basicFunction(
                      "currentModuleId",
                      [
                        "self.$RefreshReg$ = function(type, id) {",
                        Webpack.Template.indent(
                          `self.${NAMESPACE}.register(type, currentModuleId + ' ' + id);`,
                        ),
                        "};",
                      ],
                    )
                  }`,
                  "reg()",
                  "try {",
                  Webpack.Template.indent(
                    "originalFactory.call(this, moduleObject, moduleExports, webpackRequire);",
                  ),
                  "} finally {",
                  Webpack.Template.indent(
                    "self.$RefreshReg$ = prevRefreshReg;",
                  ),
                  Webpack.Template.indent(
                    "self.$RefreshSig$ = prevRefreshSig;",
                  ),
                  "}",
                ]),
                "} else {",
                Webpack.Template.indent(
                  "originalFactory.call(this, moduleObject, moduleExports, webpackRequire);",
                ),
                "}",
              ],
            )
          }`,
        ])
      })`,
      "",
    ]);
  }
}
