import type { LoaderContext } from "webpack";

type Context = LoaderContext<Record<never, never>>;

export function pitch(this: Context): string {
  const resource = this.resourcePath;
  this.addDependency(resource);
  const request = `${resource}.webpack[asset/resource]!=!${resource}`;
  return [
    `import url from ${JSON.stringify(request)};`,
    `export default new Uint8Array(await (await fetch(url)).arrayBuffer());`,
  ].join("\n");
}

export default function rawBytesLoader(this: Context, source: string): string {
  return source;
}
