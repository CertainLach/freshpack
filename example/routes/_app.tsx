import { asset } from "@fresh/core/runtime";
import { define } from "~utils";

export default define.page(function App({ Component }) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Example</title>
        <link rel="stylesheet" href={asset("/style.css")} />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});
