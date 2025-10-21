/* Same state utils as in standard fresh example */

import { createDefine } from "@fresh/core";

export interface State {
  shared: string;
}

export const define = createDefine<State>();
