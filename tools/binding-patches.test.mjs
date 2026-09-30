import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const checkout = process.env.CODEX_TEST_UPSTREAM_CHECKOUT;
test('the 0.159 binding installer verifies three ordered patches without building or changing source', () => {
  assert.ok(checkout, 'Set CODEX_TEST_UPSTREAM_CHECKOUT to the single frozen engine');
  const before = spawnSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(before.status, 0);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('tools/install-engine.ps1'), '-BindingPatchesOnly', '-VerifyOnly', '-EnginePath', checkout],
  { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /3 binding patches verified/);
  assert.equal(spawnSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, before.stdout);
});

test('the release source already supplies 0.159.2 through CLI workspace inheritance', () => {
  assert.ok(checkout);
  const workspace = readFileSync(path.join(checkout, 'codex-rs/Cargo.toml'), 'utf8');
  assert.match(workspace.split('[workspace.package]')[1], /^version = "0\.159\.2"$/m);
  assert.match(readFileSync(path.join(checkout, 'codex-rs/cli/Cargo.toml'), 'utf8'), /^version\.workspace = true$/m);
});

test('a wrong patch order fails preflight without changing the engine', () => {
  assert.ok(checkout);
  const directory = mkdtempSync(path.join(tmpdir(), 'binding-order-'));
  const before = spawnSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(before.status, 0);
  try {
    const series = path.join(directory, 'series.json');
    writeFileSync(series, JSON.stringify([
      'patch/fork-provider-binding-0.159.patch',
      'patch/model-provider-routes-0.159.patch',
      'patch/subagent-provider-binding-0.159.patch',
    ]));
    const result = spawnSync(process.execPath, ['tools/binding-patches.mjs', '--engine', checkout, '--series', series, '--apply'],
      { encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /routing\/session, fork, subagent order/);
    assert.equal(spawnSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, before.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
