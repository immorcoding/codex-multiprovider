// Check an ordered series in a temporary Git index: no second checkout, Rust, or reset.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
if (!args.includes('--engine') || !value('--engine')) throw Error('--engine requires the existing frozen checkout');
const engine = path.resolve(value('--engine'));
const baseline = JSON.parse(readFileSync(path.join(repository, 'config/engine-baseline.json'), 'utf8'));
const series = JSON.parse(readFileSync(args.includes('--series') ? value('--series') : path.join(repository, 'config/binding-patches-0.159.json'), 'utf8'));
if (series.length !== 4) throw Error('Expected exactly four combined patches');
const expectedOrder = ['model-provider-routes-0.159.patch', 'fork-provider-binding-0.159.patch', 'subagent-provider-binding-0.159.patch', 'parent-completion-0.159.patch'];
if (series.some((file, index) => path.basename(file) !== expectedOrder[index])) {
  throw Error('Patches must follow the routing/session, fork, subagent order, then parent completion');
}
const combined = args.includes('--combined');
const parentOnly = args.includes('--parent-only');
if (combined && parentOnly) throw Error('--combined cannot be combined with --parent-only');
const patches = (parentOnly ? series.slice(3) : series.slice(0, combined ? 4 : 3)).map((file) => path.resolve(repository, file));
const regenerate = args.includes('--regenerate');
const apply = args.includes('--apply');
if (apply && regenerate) throw Error('--apply cannot be combined with --regenerate');

function git(args, env = process.env) {
  const result = spawnSync('git', ['-C', engine, ...args], { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || result.stdout);
  return result.stdout;
}
if (git(['rev-parse', 'HEAD']).trim() !== baseline.sourceSha) throw Error(`Binding patches require ${baseline.sourceSha}`);
if (apply && git(['status', '--porcelain']).trim()) throw Error('Binding installation requires clean source; no changes were made');
const temporary = mkdtempSync(path.join(tmpdir(), 'codex-binding-index-'));
try {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, 'index') };
  git(['read-tree', baseline.sourceSha], env);
  let previous = baseline.sourceSha;
  const outputs = [];
  for (const patch of patches) {
    git(['apply', '--cached', '--check', '--whitespace=error', patch], env);
    git(['apply', '--cached', patch], env);
    const tree = git(['write-tree'], env).trim();
    outputs.push(git(['diff', '--full-index', '--binary', previous, tree], env));
    previous = tree;
  }
  // Finish all preflight checks before modifying any patch or working source.
  if (regenerate) patches.forEach((patch, index) => writeFileSync(patch, outputs[index]));
  if (apply) {
    for (const patch of patches) {
      git(['apply', '--check', patch]);
      git(['apply', patch]);
    }
  }
  console.log(`${patches.length} ${parentOnly ? 'parent completion' : combined ? 'combined' : 'binding'} patches verified at ${baseline.sourceSha}${apply ? ' and applied' : ' against HEAD (temporary index)'}`);
  console.log(`Result tree: ${previous}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
