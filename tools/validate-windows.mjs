// One final offline matrix, reusing the installed SDKs and verified #31 debug CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './sdk/isolated-cli-env.mjs';

assert.equal(process.platform, 'win32', 'Windows x64 acceptance only');
assert.equal(process.arch, 'x64');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.resolve(process.argv[2] ?? 'E:/Projects/codex');
const python = path.resolve(process.argv[3] ?? path.join(repository, 'work/python-sdk/Scripts/python.exe'));
assert.ok(process.argv.length <= 4, 'Usage: node tools/validate-windows.mjs [engine-path] [python-exe]');
const work = path.join(repository, 'work');
mkdirSync(work, { recursive: true });
const output = mkdtempSync(path.join(work, 'issue16-validation-'));
const home = path.join(output, 'home');
mkdirSync(home);
writeFileSync(path.join(home, 'config.toml'), '[features]\nplugins = false\n');
const env = {
  ...isolatedCliEnv(home, 'windows-matrix-fake-key'),
  CODEX_TEST_UPSTREAM_CHECKOUT: engine,
  CODEX_TEST_ROUTED_BINARY: path.join(engine, 'codex-rs/target/debug/codex.exe'),
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: engine.replaceAll('\\', '/'),
};
const summary = { issue: 16, platform: 'windows-x64', output, startedAt: new Date().toISOString(), steps: [] };
function run(name, command, args, timeout = 120_000) {
  console.log(`Running ${name}`);
  const started = performance.now();
  const result = spawnSync(command, args, { cwd: repository, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const logPath = path.join(output, `${name}.log`);
  writeFileSync(logPath, log);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; see ${logPath}\n${log.slice(-6000)}`);
  summary.steps.push({ name, command, args, exitCode: result.status, durationSeconds: (performance.now() - started) / 1000, logPath });
  return log;
}
summary.artifact = JSON.parse(run('artifact-before', process.execPath, ['tools/verify-engine-artifact.mjs', '--engine', engine]));
run('script-syntax', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/check-scripts.ps1']);
run('typescript-typecheck', process.execPath, ['tools/sdk/node_modules/typescript/bin/tsc', '--noEmit', '--project', 'tools/sdk/tsconfig.json']);
run('python-mypy', python, ['-m', 'mypy', '--strict', '--cache-dir', 'work/mypy-cache', 'tools/sdk/python/public_api.py']);
const nodeLog = run('node-matrix', process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap',
  'tools/engine-baseline.test.mjs', 'tools/binding-patches.test.mjs', 'tools/engine-artifact.test.mjs', 'tools/proxy-transforms.test.mjs',
  'tools/engine-initialize.test.mjs', 'tools/model-routing.test.mjs', 'tools/glm-responses.test.mjs', 'tools/sdk/sdk-routing.test.mjs'], 300_000);
assert.match(nodeLog, /# tests 54\r?\n/);
for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.match(nodeLog, new RegExp(`# ${name} 0\\r?\\n`), `${name} must be zero`);
summary.node = { passed: 54, failed: 0, cancelled: 0, skipped: 0 };
const pythonLog = run('python-matrix', python, ['-m', 'pytest', '-q', 'tools/sdk/python/test_routing.py', '-p', 'no:cacheprovider', '--basetemp', path.join(output, 'pytest')]);
assert.match(pythonLog, /\b2 passed\b/);
assert.doesNotMatch(pythonLog, /\b(?:skipped|failed|error|xfailed|deselected)\b/i);
summary.python = { passed: 2, failed: 0, skipped: 0 };
const after = JSON.parse(run('artifact-after', process.execPath, ['tools/verify-engine-artifact.mjs', '--engine', engine]));
assert.deepEqual(after, summary.artifact, 'Artifact changed during acceptance');
summary.completedAt = new Date().toISOString();
writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
