// Give the real CLI only process-startup variables and disposable user state.
import { isolatedProcessEnv } from '../isolated-process-env.mjs';
/** @param {string} home @param {string} fakeKey */
export function isolatedCliEnv(home, fakeKey) {
  return {
    ...isolatedProcessEnv(home),
    ZAI_CODING_PLAN_API_KEY: fakeKey,
  };
}
