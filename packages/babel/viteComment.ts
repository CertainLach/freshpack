// deno-lint-ignore no-explicit-any
function rewrite(arg: any) {
  if (!arg?.leadingComments) return;

  for (const comment of arg.leadingComments) {
    if (comment.value.includes("@vite-ignore")) {
      comment.value = comment.value.replace(
        "@vite-ignore",
        "webpackIgnore: true",
      );
    }
  }
}

export default function babelViteCommentPlugin(
  _opts?: Record<string, never>,
) {
  return {
    visitor: {
      // deno-lint-ignore no-explicit-any
      CallExpression(path: any) {
        if (path.node.callee.type !== "Import") return;
        rewrite(path.node.arguments[0]);
      },
      // deno-lint-ignore no-explicit-any
      ImportExpression(path: any) {
        rewrite(path.node.source);
      },
    },
  };
}
