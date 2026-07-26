import { useEffect, useState } from "preact/hooks";
import { Head } from "@freshpack/core/runtime";

export function TemplateIsland() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <div class={ready ? "ready" : ""}>
      <Head>
        <template key="a">ok</template>
      </Head>
    </div>
  );
}
