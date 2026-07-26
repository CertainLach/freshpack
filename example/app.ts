/* App definition, used by both development and production servers */

import { App, staticFiles } from "@freshpack/core";
import type { State } from "~utils";

export const app = new App<State>()
  .use(staticFiles())
  .fsRoutes();
