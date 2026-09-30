import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(repository, 'tools', 'install-engine.ps1');
const checkout = process.env.CODEX_TEST_UPSTREAM_CHECKOUT;
const expectedSha = 'ff6aec96948b70d94983af2641a6b67c94faeff5';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  if (command === 'git') assert.equal(result.status, 0, result.stderr);
  return result;
}

function install(...args) {
  return run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, ...args]);
}

test('baseline verification accepts clean source and rejects the shared patched source without building', () => {
  assert.ok(checkout, 'Set CODEX_TEST_UPSTREAM_CHECKOUT to the existing clean rust-v0.159.2 checkout');
  const before = run('git', ['-C', checkout, 'status', '--porcelain']).stdout;
  const result = install('-BaselineOnly', '-VerifyOnly', '-EnginePath', checkout);
  assert.equal(run('git', ['-C', checkout, 'status', '--porcelain']).stdout, before);
  if (before.trim()) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /uncommitted changes/);
    return;
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(result.stdout.includes(expectedSha));
  assert.match(result.stdout, /Verified without patching or compiling/);
  assert.equal(run('git', ['-C', checkout, 'status', '--porcelain']).stdout.trim(), '');
});

test('baseline verification rejects a dirty source and preserves the user file', () => {
  assert.ok(checkout);
  const marker = path.join(checkout, `codex-mp-test-${process.pid}.txt`);
  writeFileSync(marker, 'preserve this user file', { flag: 'wx' });
  try {
    const result = install('-BaselineOnly', '-VerifyOnly', '-EnginePath', checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /uncommitted changes/);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve this user file');
    assert.equal(run('git', ['-C', checkout, 'rev-parse', 'HEAD']).stdout.trim(), expectedSha);
  } finally {
    unlinkSync(marker);
  }
});

test('baseline verification rejects another commit without checking out or modifying files', () => {
  // Use this repository as a wrong-SHA input; no second engine checkout is created.
  const before = run('git', ['-C', repository, 'status', '--porcelain']).stdout;
  const head = run('git', ['-C', repository, 'rev-parse', 'HEAD']).stdout;
  const result = install('-BaselineOnly', '-VerifyOnly', '-EnginePath', repository);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checked out .* but this build needs/);
  assert.ok(result.stderr.includes(expectedSha));
  assert.equal(run('git', ['-C', repository, 'status', '--porcelain']).stdout, before);
  assert.equal(run('git', ['-C', repository, 'rev-parse', 'HEAD']).stdout, head);
});

test('historical installers reject 0.159 source without applying old diffs', () => {
  assert.ok(checkout);
  const before = run('git', ['-C', checkout, 'status', '--porcelain']).stdout;
  for (const args of [[], ['-RoutingPatch']]) {
    const result = install(...args, '-EnginePath', checkout);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checked out .* but this build needs/);
    assert.equal(run('git', ['-C', checkout, 'status', '--porcelain']).stdout, before);
  }
});

test('combined installation rejects dirty source without discarding patches or compiling', () => {
  const before = run('git', ['-C', checkout, 'status', '--porcelain']).stdout;
  if (!before.trim()) return; // Clean apply is covered by the Windows lightweight workflow.
  const result = install('-CombinedPatch', '-EnginePath', checkout);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncommitted changes/);
  assert.equal(run('git', ['-C', checkout, 'status', '--porcelain']).stdout, before);
});

test('stable modes require an existing checkout and unambiguous options', () => {
  for (const args of [
    ['-BaselineOnly', '-VerifyOnly'],
    ['-BaselineOnly', '-VerifyOnly', '-EnginePath', checkout, '-WorkDir', 'unused-engine'],
    ['-BaselineOnly', '-CombinedPatch', '-EnginePath', checkout],
    ['-BaselineOnly', '-RoutingPatch', '-EnginePath', checkout],
    ['-BindingPatchesOnly'],
    ['-BindingPatchesOnly', '-WorkDir', 'unused-engine', '-EnginePath', checkout],
    ['-BindingPatchesOnly', '-CombinedPatch', '-EnginePath', checkout],
    ['-BindingPatchesOnly', '-RoutingPatch', '-EnginePath', checkout],
    ['-CombinedPatch'],
    ['-CombinedPatch', '-WorkDir', 'unused-engine', '-EnginePath', checkout],
    ['-VerifyOnly', '-EnginePath', checkout],
  ]) {
    const result = install(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires?|cannot be combined/);
  }
});

test('the frozen release record distinguishes published packages from historical evidence', () => {
  const record = JSON.parse(readFileSync(path.join(repository, 'config', 'engine-baseline.json'), 'utf8'));
  assert.deepEqual(record, {
    tag: 'rust-v0.159.2',
    sourceSha: expectedSha,
    platform: 'windows-x64',
    publishedVersions: {
      '@openai/codex': '0.159.2',
      '@openai/codex-sdk': '0.159.2',
      'openai-codex': '0.159.2',
      'openai-codex-cli-bin': '0.159.2',
    },
  });
  const doc = readFileSync(path.join(repository, 'docs', 'engine-baseline.md'), 'utf8');
  assert.ok(doc.includes(expectedSha));
  assert.ok(doc.includes('0.0.0-dev'));
  assert.ok(doc.includes('064c6b8c737f5b41d171fdda80bd9ef10ad06eb3'));
});
