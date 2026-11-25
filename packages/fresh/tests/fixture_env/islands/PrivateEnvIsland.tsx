export function PrivateEnvIsland() {
  return <pre>{Deno.env.get("FRESH_PRIVATE_TEST_FOO")}</pre>;
}
