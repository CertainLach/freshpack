/* App definition, used by both development and production servers */

import { App, staticFiles } from "@fresh/core";
import type { State } from "./utils.ts";

export const app = new App<State>()
  .use(staticFiles())
  .fsRoutes();
