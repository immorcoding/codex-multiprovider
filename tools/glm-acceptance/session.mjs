import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockKey, startMockProvider } from './mock-provider.mjs';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const profiles = JSON.parse(readFileSync(path.join(repository, 'config/glm-acceptance-profiles.json'), 'utf8'));

export function childEnvironment(home, keyEnv) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'COMSPEC']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME']) env[key] = home;
  // The real service key stays in the coordinator, never in a model-driven process.
  if (keyEnv) env[keyEnv] = 'local-acceptance-relay-key';
  return env;
}

export async function runProcess(command, args, { env, cwd = repository, timeoutMs = 120_000 } = {}) {
  const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  // Do not persist stderr: provider errors may contain credentials or private text.
  child.stderr.resume();
  let failure;
  const timer = setTimeout(() => { failure = 'TIMEOUT'; child.kill(); }, timeoutMs);
  child.stdout.on('data', bytes => {
    stdout += bytes;
    if (stdout.length > 2 * 1024 * 1024) { failure = 'OUTPUT_LIMIT'; child.kill(); }
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', () => reject(Error('PROCESS_START_FAILED')));
      child.once('exit', resolve);
    });
    if (failure || code !== 0) throw Error(failure ?? 'PROBE_FAILED');
    return stdout;
  } finally { clearTimeout(timer); child.kill(); }
}

export async function createSession(options, report) {
  const work = path.join(repository, 'work');
  mkdirSync(work, { recursive: true });
  const directory = mkdtempSync(path.join(work, 'glm-acceptance-' + options.profile + '-'));
  const home = path.join(directory, 'home');
  const workspace = path.join(home, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const mock = options.mode === 'live' ? null : await startMockProvider(options.scenario);
  const upstream = mock?.baseUrl ?? options.baseUrl;
  const key = mock ? mockKey : process.env[profiles[options.profile].keyEnv];
  const controllers = new Set();
  const server = http.createServer(async (request, response) => {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      if (request.method !== 'POST' || request.url !== '/api/v1/responses' ||
          request.headers.authorization !== 'Bearer local-acceptance-relay-key') throw Error('REQUEST_REJECTED');
      let raw = '';
      for await (const bytes of request) {
        raw += bytes;
        if (raw.length > 512 * 1024) throw Error('REQUEST_TOO_LARGE');
      }
      const body = JSON.parse(raw);
      if (body.model !== 'glm-5.3-flash' || !['low', 'high', 'max'].includes(body.reasoning?.effort)) throw Error('REQUEST_REJECTED');
      if (report.requests >= options.maxRequests) throw Error('REQUEST_BUDGET_EXHAUSTED');
      report.requests += 1; // Count before dispatch; concurrent requests share the same finite budget.
      const observed = { model: body.model, effort: body.reasoning.effort, status: null };
      report.observations.push(observed);
      const result = await fetch(upstream + '/responses', { method: 'POST', redirect: 'manual',
        headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: raw, signal: controller.signal });
      observed.status = result.status;
      if (!result.ok) {
        report.errorCode = 'PROVIDER_HTTP_ERROR';
        await result.body?.cancel();
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Provider HTTP status ' + result.status } }));
        return;
      }
      response.writeHead(200, { 'content-type': result.headers.get('content-type') ?? 'text/event-stream' });
      const decoder = new TextDecoder();
      let pending = '';
      // Hold potential partial key matches across chunks; never pass the real key into the CLI or its persisted state.
      for await (const bytes of result.body) {
        pending = (pending + decoder.decode(bytes, { stream: true })).replaceAll(key, '[REDACTED]');
        const safeLength = Math.max(0, pending.length - key.length + 1);
        response.write(pending.slice(0, safeLength));
        pending = pending.slice(safeLength);
      }
      response.end((pending + decoder.decode()).replaceAll(key, '[REDACTED]'));
    } catch (error) {
      report.errorCode ??= controller.signal.aborted ? 'TIMEOUT' :
        ['REQUEST_REJECTED', 'REQUEST_TOO_LARGE', 'REQUEST_BUDGET_EXHAUSTED'].includes(error.message) ? error.message : 'TRANSPORT_FAILED';
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"Acceptance relay stopped"}}');
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = profiles[options.profile];
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  const catalog = path.join(home, 'models.json');
  writeFileSync(catalog, readFileSync(path.join(repository, 'config/zai-models.json')));
  writeFileSync(path.join(home, 'config.toml'),
    'model = "glm-5.3-flash"\nmodel_provider = ' + JSON.stringify(profile.provider) +
    '\nmodel_reasoning_effort = "low"\nmodel_catalog_json = ' + JSON.stringify(catalog.replaceAll('\\', '/')) +
    '\napproval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\n[features]\nplugins = false\n' +
    '[model_providers.' + profile.provider + ']\nname = "Acceptance relay"\nbase_url = ' + JSON.stringify(baseUrl) +
    '\nwire_api = "responses"\nenv_key = ' + JSON.stringify(profile.keyEnv) +
    '\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n' +
    '[model_provider_routes]\n"glm-5.3-flash" = ' + JSON.stringify(profile.provider) + '\n');
  return { directory, home, workspace, env: childEnvironment(home, profile.keyEnv),
    async close() {
      for (const controller of controllers) controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await mock?.close();
    } };
}
