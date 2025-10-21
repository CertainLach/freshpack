// declare const __prefresh_utils__: any;
// declare const __prefresh_errors__: any;
// declare const __webpack_module__: any;
// declare const __webpack_modules__: any;
// declare const error: any;

const isPrefreshComponent = __prefresh_utils__.shouldBind(__webpack_module__);

// `@vanilla-extract/webpack` does some custom preprocessing where
// `module.hot` is partially replaced. This leads to our injected
// code being executed although it shouldn't be:
//
// Intermediate result:
//
//   if (true) { // <- inlined by intermediate compile step
//     const previousHotModuleExports = module.hot.data && ...
//                    // Crash happens here ---^
//
// It crashes at that line because some intermediate compiler isn't
// running in hot mode, but the overall guard condition was compiled
// down to being truthy. By moving `module.hot` outside of the
// condition of the if-statement, it will be left as is.
const moduleHot = __webpack_module__.hot;

if (moduleHot) {
  const currentExports = __prefresh_utils__.getExports(__webpack_module__);
  const previousHotModuleExports = moduleHot.data &&
    moduleHot.data.moduleExports;

  __prefresh_utils__.registerExports(currentExports, __webpack_module__.id);

  if (isPrefreshComponent) {
    if (previousHotModuleExports) {
      try {
        __prefresh_utils__.flush();
        if (
          typeof __prefresh_errors__ !== "undefined" &&
          __prefresh_errors__ &&
          __prefresh_errors__.clearRuntimeErrors
        ) {
          __prefresh_errors__.clearRuntimeErrors();
        }
      } catch (e) {
        // Only available in newer webpack versions.
        if (moduleHot.invalidate) {
          moduleHot.invalidate();
        } else {
          console.log("[PREFRESH] Failed to flush updates:", e);
          self.location.reload();
        }
      }
    }

    moduleHot.dispose((data) => {
      data.moduleExports = __prefresh_utils__.getExports(__webpack_module__);
    });

    moduleHot.accept(function errorRecovery() {
      if (
        typeof __prefresh_errors__ !== "undefined" &&
        __prefresh_errors__ &&
        __prefresh_errors__.handleRuntimeError
      ) {
        __prefresh_errors__.handleRuntimeError(error);
      }

      __webpack_modules__[__webpack_module__.id].hot.accept(errorRecovery);
    });
  }
}
