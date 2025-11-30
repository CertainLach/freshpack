import Module from "node:module";

const overrides = new Map<string, Record<string, unknown>>();
let overrideId = 0;

const originalLoad = Module.prototype.require;
Module.prototype.require = function hookedRequire(id: string) {
  const override = overrides.get(id);
  if (override) {
    return override;
  }
  return originalLoad.apply(this, arguments as any);
};

export function defineRequire(
  name: string,
  module: Record<string, unknown>,
): string {
  const generatedName = `override:${name}/${overrideId++}`;
  overrides.set(generatedName, module);
  return generatedName;
}
