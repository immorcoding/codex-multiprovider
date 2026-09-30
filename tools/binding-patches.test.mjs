import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const checkout = process.env.CODEX_TEST_UPSTREAM_CHECKOUT;
test('the combined installer verifies four patches on the shared dirty checkout without building or changing source/index', () => {
  assert.ok(checkout);
  const status = () => spawnSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
  const index = () => spawnSync('git', ['-C', checkout, 'diff', '--cached', '--raw'], { encoding: 'utf8' }).stdout;
  const before = [status(), index()];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('tools/install-engine.ps1'), '-CombinedPatch', '-VerifyOnly', '-EnginePath', checkout],
  { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /4 combined patches verified/);
  assert.deepEqual([status(), index()], before);
});

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

test('the new parent completion patch applies independently at the frozen SHA', () => {
  assert.ok(checkout);
  const result = spawnSync(process.execPath, ['tools/binding-patches.mjs', '--engine', checkout, '--parent-only'],
    { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /1 parent completion patches verified/);
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
      'patch/parent-completion-0.159.patch',
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

test('a broken fourth patch fails all preflight before regeneration can overwrite earlier diffs', () => {
  assert.ok(checkout);
  const directory = mkdtempSync(path.join(tmpdir(), 'combined-preflight-'));
  const earlier = JSON.parse(readFileSync('config/binding-patches-0.159.json', 'utf8')).slice(0, 3).map(file => path.resolve(file));
  const before = earlier.map(file => readFileSync(file));
  try {
    const broken = path.join(directory, 'parent-completion-0.159.patch');
    writeFileSync(broken, 'this is not a patch\n');
    const series = path.join(directory, 'series.json');
    writeFileSync(series, JSON.stringify([...earlier, broken]));
    const result = spawnSync(process.execPath, ['tools/binding-patches.mjs', '--engine', checkout, '--series', series, '--combined', '--regenerate'],
      { encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No valid patches/);
    assert.deepEqual(earlier.map(file => readFileSync(file)), before);
    assert.equal(readFileSync(broken, 'utf8'), 'this is not a patch\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
