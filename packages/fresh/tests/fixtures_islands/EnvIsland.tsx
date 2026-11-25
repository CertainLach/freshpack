import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

export interface EnvIslandProps {
  id?: string;
}

export function EnvIsland(props: EnvIslandProps) {
  const active = useSignal(false);
  useEffect(() => {
    active.value = true;
  }, []);

  const deno = Deno.env.get("FRESH_PUBLIC_TEST_FOO");
  const deno2 = Deno.env.get("FRESH_PUBLIC_TEST_FOO");

  return (
    <div id={props.id} class={active.value ? "ready" : ""}>
      <pre class="deno-env">{deno}</pre>
      <pre class="deno-env-2">{deno2}</pre>
    </div>
  );
}
