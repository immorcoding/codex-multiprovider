import { profiles } from './session.mjs';

export const availableCases = ['text-low', 'text-high', 'text-max', 'tool-loop', 'typescript', 'python'];
export function parseOptions(args) {
  const switches = new Set(['--live', '--mock', '--confirm-live', '--responses-qualified']);
  const values = new Set(['--profile', '--cases', '--max-requests', '--base-url', '--engine', '--python', '--timeout-ms', '--mock-scenario']);
  const flags = new Map();
  const invalid = () => { throw Error('INVALID_OPTIONS'); };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flags.has(flag)) invalid();
    if (switches.has(flag)) flags.set(flag, true);
    else if (values.has(flag) && args[i + 1] && !args[i + 1].startsWith('--')) flags.set(flag, args[++i]);
    else invalid();
  }
  const mode = flags.has('--live') ? 'live' : 'mock';
  const profile = flags.get('--profile') ?? 'coding-plan';
  if (!Object.hasOwn(profiles, profile) || (flags.has('--mock') && flags.has('--live'))) invalid();
  const cases = (flags.get('--cases') ?? (mode === 'mock' ? 'all' : 'text-low'));
  const selected = cases === 'all' ? [...availableCases] : cases.split(',');
  if (new Set(selected).size !== selected.length || selected.some(name => !availableCases.includes(name))) invalid();
  const integer = (flag, fallback, maximum) => {
    const value = flags.get(flag);
    if (value == null) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) invalid();
    return Number(value);
  };
  const scenario = flags.get('--mock-scenario') ?? 'success';
  if (!['success', 'secret-error', 'missing-completed', 'slow', 'inconsistent-call-id'].includes(scenario) || (mode === 'live' && flags.has('--mock-scenario')) ||
      (mode === 'mock' && flags.has('--base-url'))) invalid();
  return { mode, profile, cases: selected, confirmLive: flags.has('--confirm-live'),
    qualified: flags.has('--responses-qualified'), maxRequests: integer('--max-requests', mode === 'mock' ? 12 : undefined, 50),
    timeoutMs: integer('--timeout-ms', 120_000, 300_000), scenario,
    baseUrl: flags.get('--base-url'), engine: flags.get('--engine') ?? 'E:/Projects/codex', python: flags.get('--python') };
}

export function validateLiveEndpoint(options) {
  const profile = profiles[options.profile];
  const base = options.baseUrl ?? profile.baseUrl;
  if (!base) throw Error('BASE_URL_REQUIRED');
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
        !profile.responsesHosts.includes(url.hostname) || !profile.responsesBasePaths.includes(url.pathname.replace(/\/$/, ''))) throw Error();
    options.baseUrl = url.origin + url.pathname.replace(/\/$/, '');
  } catch { throw Error('BASE_URL_REJECTED'); }
}
