import type { IslandPreparer, setBuildCache } from "@fresh/core/internal";
import type * as Webpack from "webpack";

export type OriginalBuildCache<State> = Parameters<
  typeof setBuildCache<State>
>[1];
export type ServerIslandRegistry = Parameters<IslandPreparer["prepare"]>[0];
export type OriginalStaticFile = ReturnType<
  OriginalBuildCache<unknown>["readFile"]
>;
export type WebpackFS = Exclude<Webpack.Compiler["outputFileSystem"], null>;
