/** Windows process startup plus disposable user state; credential policy belongs to the caller.
 * @param {string} home
 * @returns {Record<string, string>}
 */
export function isolatedProcessEnv(home) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']) env[key] = home;
  return env;
}
