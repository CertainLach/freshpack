/**
 * Don't use this package directly. It's considered internal for Fresh.
 *
 * @example
 * ```ts
 * // `BUILD_ID` is based on the `DENO_DEPLOYMENT_ID` environment variable.
 * ```
 *
 * @see https://fresh.deno.dev/docs/deployment/docker
 *
 * @module
 * @private
 */
export declare const DENO_DEPLOYMENT_ID: string | undefined;
export declare let BUILD_ID: string;
export declare function setBuildId(buildId: string): void;
