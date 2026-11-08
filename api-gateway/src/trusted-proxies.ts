/** Empty means direct access: client-supplied forwarding headers are untrusted. */
export function trustedProxies(
  env: NodeJS.ProcessEnv = process.env,
): false | string[] {
  const proxies = (env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return proxies.length ? proxies : false;
}
