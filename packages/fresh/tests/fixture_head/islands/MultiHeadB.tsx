import { useEffect, useState } from "preact/hooks";
import { Head } from "@freshpack/core/runtime";

export function MultiHeadB() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  return (
    <div class={ready ? "ready-b" : ""}>
      <Head>
        <meta name="description" content="from-island-b" />
      </Head>
    </div>
  );
}
