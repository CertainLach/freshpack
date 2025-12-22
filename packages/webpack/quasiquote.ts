export type JsRaw = { _jsRaw: string };
type ToJsRaw =
  | string
  | JsRaw
  | (ToJsRaw[])
  | Record<string, string | JsRaw>
  | Map<string, JsRaw>
  | undefined;
export function toJsRaw(v: ToJsRaw): JsRaw {
  if (typeof v === "string") {
    return { _jsRaw: JSON.stringify(v) };
  }
  if (v instanceof Array) {
    return {
      _jsRaw: "[" + v.map((v) =>
        toJsRaw(v)._jsRaw
      ).join(v.length > 5 ? ",\n" : ",") +
        "]",
    };
  }
  if (v instanceof Map) {
    return js`new Map(${
      v.entries().map(([name, v]) => js`[${name},${v}]`).toArray()
    })`;
  }
  if (typeof v === "object" && !("_jsRaw" in v)) {
    const entries = Object.entries(v);
    return {
      _jsRaw: "{" + entries.map(([name, v]) =>
        `${name}:${toJsRaw(v)._jsRaw}`
      ).join(entries.length > 10 ? ",\n" : ",") + "}",
    };
  }
  if (typeof v === "undefined") {
    return js`undefined`;
  }
  if (v === null) {
    return js`null`;
  }
  return v as JsRaw;
}
export const js = (template: TemplateStringsArray, ...subs: ToJsRaw[]) => ({
  _jsRaw: String.raw(template, ...subs.map((v) => toJsRaw(v)._jsRaw)),
});
