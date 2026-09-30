// Verify the existing #31 artifact before reusing its Rust evidence. Never build or apply patches.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedCliEnv } from './sdk/isolated-cli-env.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert.ok(['--engine', '--record'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--'), 'Expected --engine <path> or --record <file>');
}
const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const record = JSON.parse(readFileSync(value('--record') ?? path.join(repository, 'docs/engine-validation-0.159.json'), 'utf8'));
const engine = path.resolve(value('--engine') ?? record.enginePath);
const baseline = JSON.parse(readFileSync(path.join(repository, 'config/engine-baseline.json'), 'utf8'));
const series = JSON.parse(readFileSync(path.join(repository, 'config/binding-patches-0.159.json'), 'utf8'));
const sha256 = async file => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
function git(...args) {
  const result = spawnSync('git', ['-c', `safe.directory=${engine.replaceAll('\\', '/')}`, '-C', engine, ...args], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}
assert.equal(process.platform, 'win32', 'This artifact is Windows only');
assert.equal(process.arch, 'x64');
assert.equal(realpathSync(engine), realpathSync(record.enginePath), 'Reuse the single engine');
assert.equal(record.sourceSha, baseline.sourceSha);
assert.deepEqual(record.patches.map(patch => patch.path), series);
for (const patch of record.patches) {
  assert.equal(await sha256(path.join(repository, patch.path)), patch.sha256, `Patch fingerprint mismatch: ${patch.path}`);
}
assert.equal(git('rev-parse', 'HEAD'), record.sourceSha);
assert.equal(git('rev-parse', `${baseline.tag}^{commit}`), record.sourceSha);
assert.equal(git('branch', '--show-current'), record.engineBranch);
assert.equal(git('diff', '--cached', '--raw'), '', 'Real index must match frozen HEAD');
const patchFiles = git('diff', '--name-only', record.sourceSha, record.patchTree).split('\n');
assert.equal(patchFiles.length, 42);
assert.equal(record.verifiedPatchSourceBlobs, patchFiles.length);
const lock = 'codex-rs/Cargo.lock';
assert.deepEqual(git('diff', '--name-only', record.patchTree, record.buildSourceTree).split('\n'), [lock]);
const sourceFiles = [...patchFiles, lock].sort();
const status = git('status', '--porcelain', '--untracked-files=all').split('\n');
const dirtyFiles = status.map(line => line.slice(3)).sort();
assert.deepEqual(dirtyFiles, sourceFiles, 'Unexpected source changes');
for (const file of sourceFiles) {
  assert.equal(git('hash-object', `--path=${file}`, path.join(engine, file)), git('rev-parse', `${record.buildSourceTree}:${file}`), `Source blob mismatch: ${file}`);
}
assert.equal(await sha256(path.join(engine, lock)), record.cargoLockSha256);
const preflight = spawnSync(process.execPath, [path.join(repository, 'tools/binding-patches.mjs'), '--engine', engine], {
  encoding: 'utf8', timeout: 30_000,
  env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: engine.replaceAll('\\', '/') },
});
assert.ifError(preflight.error);
assert.equal(preflight.status, 0, preflight.stderr);
assert.ok(preflight.stdout.includes(`Result tree: ${record.patchTree}`), preflight.stdout);
const binary = path.join(engine, 'codex-rs/target/debug/codex.exe');
assert.equal(realpathSync(binary), realpathSync(record.binaryPath));
assert.equal(realpathSync(path.join(engine, 'codex-rs/target')), realpathSync(record.targetDirectory));
assert.equal(statSync(binary).size, record.binaryBytes);
assert.equal(await sha256(binary), record.binarySha256);
const home = mkdtempSync(path.join(tmpdir(), 'codex-artifact-home-'));
try {
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30_000, env: isolatedCliEnv(home, 'artifact-probe-fake-key'), windowsHide: true });
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), record.version);
} finally {
  assert.ok(path.resolve(home).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
  rmSync(home, { recursive: true, force: true });
}
console.log(JSON.stringify({ sourceSha: record.sourceSha, patchTree: record.patchTree, buildSourceTree: record.buildSourceTree,
  verifiedPatchSourceBlobs: patchFiles.length, verifiedBuildSourceBlobs: sourceFiles.length, realIndexMatchesFrozenHead: true,
  patches: record.patches, cargoLockSha256: record.cargoLockSha256, binaryPath: binary, binarySha256: record.binarySha256, version: record.version }, null, 2));
