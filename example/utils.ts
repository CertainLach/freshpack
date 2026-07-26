/* Same state utils as in standard fresh example */

import { createDefine } from "@freshpack/core";

export interface State {
  shared: string;
}

export const define = createDefine<State>();
