import type Webpack from "webpack";

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

export function createPrefreshRuntimeModule(
  webpack: Webpack.Compiler["webpack"],
): new () => Webpack.RuntimeModule {
  const { RuntimeGlobals, RuntimeModule, Template } = webpack;

  return class PrefreshRuntimeModule extends RuntimeModule {
    constructor() {
      super("prefresh", 5);
    }

    override generate() {
      const { runtimeTemplate } = this.compilation as any;
      const declare = runtimeTemplate.supportsConst() ? "const" : "var";

      return Template.asString([
        `${RuntimeGlobals.interceptModuleExecution}.push(${
          runtimeTemplate.basicFunction("options", [
            `${declare} originalFactory = options.factory;`,
            `options.factory = ${
              runtimeTemplate.basicFunction(
                "moduleObject, moduleExports, webpackRequire",
                [
                  `if (typeof self !== "undefined" && typeof self.${NAMESPACE} !== "undefined") {`,
                  Template.indent([
                    `${declare} prevRefreshReg = self.$RefreshReg$;`,
                    `${declare} prevRefreshSig = self.$RefreshSig$;`,
                    beforeModule,
                    `${declare} reg = ${
                      runtimeTemplate.basicFunction(
                        "currentModuleId",
                        [
                          "self.$RefreshReg$ = function(type, id) {",
                          Template.indent(
                            `self.${NAMESPACE}.register(type, currentModuleId + ' ' + id);`,
                          ),
                          "};",
                        ],
                      )
                    }`,
                    "reg()",
                    "try {",
                    Template.indent(
                      "originalFactory.call(this, moduleObject, moduleExports, webpackRequire);",
                    ),
                    "} finally {",
                    Template.indent(
                      "self.$RefreshReg$ = prevRefreshReg;",
                    ),
                    Template.indent(
                      "self.$RefreshSig$ = prevRefreshSig;",
                    ),
                    "}",
                  ]),
                  "} else {",
                  Template.indent(
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
  };
}
