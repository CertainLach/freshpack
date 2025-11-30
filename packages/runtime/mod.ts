import { unmapping } from "./internal.ts";

const IS_BROWSER = typeof document !== "undefined";

export function unmap(name: string, url: URL): string {
  if (IS_BROWSER) {
    console.error("browser unmapping should be done using webpack plugin");
    return url.href;
  }
  if (!unmapping) {
    console.error("missing unmapping registration");
    return url.href;
  }
  const unmapped = unmapping[name];
  if (!unmapped) {
    console.error("missing unmapping registration for", name);
    return url.href;
  }
  return unmapped.toString();
}
