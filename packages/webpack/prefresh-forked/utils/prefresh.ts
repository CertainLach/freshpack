import { flush, isComponent } from "@prefresh/utils";

// eslint-disable-next-line
export const getExports = (m: any) => m.exports || m.__proto__.exports;

function isSafeExport(key: string) {
  return (
    key === "__esModule" ||
    key === "__N_SSG" ||
    key === "__N_SSP" ||
    key === "config"
  );
}

export function registerExports(moduleExports: any, moduleId: string) {
  if (typeof self !== "undefined") {
    self["__PREFRESH__"].register(moduleExports, moduleId + " %exports%");
    if (moduleExports == null || typeof moduleExports !== "object") return;

    for (const key in moduleExports) {
      if (isSafeExport(key)) continue;
      const exportValue = moduleExports[key];
      const typeID = moduleId + " %exports% " + key;
      self["__PREFRESH__"].register(exportValue, typeID);
    }
  }
}

export const shouldBind = (m: any) => {
  let isCitizen = false;
  const moduleExports = getExports(m);

  if (isComponent(moduleExports)) {
    isCitizen = true;
  }

  if (
    moduleExports === undefined ||
    moduleExports === null ||
    typeof moduleExports !== "object"
  ) {
    isCitizen = isCitizen || false;
  } else {
    for (const key in moduleExports) {
      if (key === "__esModule") continue;

      const exportValue = moduleExports[key];
      if (isComponent(exportValue)) {
        isCitizen = isCitizen || true;
      }
    }
  }

  return isCitizen;
};

export { flush };
