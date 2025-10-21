export default function babelEnvPlugin(
	allowedEnv: (string | RegExp)[] = [],
) {
	allowedEnv.push(/^FRESH_PUBLIC_/);
	allowedEnv.push("NODE_ENV");
	allowedEnv.push("DENO_DEPLOYMENT_ID");
	allowedEnv.push("GITHUB_SHA");
	allowedEnv.push("CI_COMMIT_SHA");
	allowedEnv.push("CI");

	const isAllowed = (v: string) => {
		for (const allowed of allowedEnv) {
			if (allowed instanceof RegExp && allowed.test(v)) return true;
			else if (allowed === v) return true;
		}
	};
	return {
		visitor: {
			// deno-lint-ignore no-explicit-any
			CallExpression(path: any) {
				const { callee, arguments: args } = path.node;

				if (
					callee.type === "MemberExpression" &&
					callee.object.type === "MemberExpression" &&
					callee.object.object.name === "Deno" &&
					callee.object.property.name === "env" &&
					callee.property.name === "get" &&
					args.length === 1 &&
					args[0].type === "StringLiteral"
				) {
					const env = args[0].value;

					if (!isAllowed(env)) {
						throw path.buildCodeFrameError(
							`Env var is not allowed in bundling: ${env}`,
						);
					}

					const value = Deno.env.get(env);
					const leadingComments = [{
						type: "CommentBlock",
						value: ` Deno.env.get(${JSON.stringify(env)}) = `,
					}];
					if (value === undefined) {
						path.replaceWith({
							type: "Identifier",
							name: "undefined",
							leadingComments,
						});
					} else if (value === null) {
						path.replaceWith({
							type: "NullLiteral",
							value: null,
							leadingComments,
						});
					} else {
						path.replaceWith({
							type: "StringLiteral",
							value,
							leadingComments,
						});
					}
				}
			},
		},
	};
}
