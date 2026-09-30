// Give the real CLI only process-startup variables and disposable user state.
/** @param {string} home @param {string} fakeKey */
export function isolatedCliEnv(home, fakeKey) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env,
    USERPROFILE: home,
    HOME: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    CODEX_HOME: home,
    ZAI_CODING_PLAN_API_KEY: fakeKey,
  };
}
