import { LibIsland } from "../../fixture_lib/mod.ts";

export const handler = () => new Response(LibIsland.name);
