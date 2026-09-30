import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
import path from 'node:path';
import { childEnvironment } from './session.mjs';
const [binary, home, provider, keyName, timeoutValue] = process.argv.slice(2);
assert.ok(binary && home && provider && keyName && process.env[keyName], 'Missing arguments/key');
const env = childEnvironment(home, keyName);
const child = spawn(binary, ['app-server'], {cwd:path.join(home,'workspace'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stderr.resume(); // Never print provider bodies, credentials or reasoning.
const pending = new Map();
const called = new Set(), started = new Set(), completed = new Set();
const marker = 'probe-' + randomBytes(8).toString('hex');
let seq = 0, active = null, threadId;
const finishedTurns = new Set();
let protocolFailure;
function rejectProtocol(message) {
  protocolFailure ??= new Error(message);
  active?.reject(protocolFailure);
}
const send = m => child.stdin.write(JSON.stringify(m) + '\n');
function fail() {
  for (const p of pending.values()) p.reject(new Error('RPC/transport failure'));
  active?.reject(new Error('RPC/transport failure'));
}
child.on('error', fail);
child.on('exit', fail);
function handleTurnMessage(m) {
  if (active && !active.turnId) { active.buffer.push(m); return; }
  if (m.id != null && m.method) {
    const p = m.params ?? {};
    if (m.method !== 'item/tool/call' || p.tool !== 'acceptance_echo' ||
        p.threadId !== threadId || p.turnId !== active?.turnId || !p.callId || called.has(p.callId) || called.size >= 1) {
      send({id:m.id,error:{code:-32601,message:'Unexpected/duplicate tool request'}});
      rejectProtocol('Unexpected/duplicate tool request'); return;
    }
    called.add(p.callId);
    send({id:m.id,result:{contentItems:[{type:'inputText',text:marker}],success:true}});
    return;
  }
  const p = m.params ?? {};
  if (p.threadId !== threadId) return;
  if (!['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed'].includes(m.method)) return;
  const observedTurn = m.method === 'turn/completed' ? p.turn?.id : p.turnId;
  if (!active || observedTurn !== active.turnId || finishedTurns.has(observedTurn)) {
    rejectProtocol('Wrong, duplicate or stale turn'); return;
  }
  if (m.method === 'item/agentMessage/delta') {
    active.delta += 1; active.text += p.delta ?? '';
  }
  if (m.method === 'item/started' && p.item?.type === 'dynamicToolCall') started.add(p.item.id);
  if (m.method === 'item/completed' && p.item?.type === 'dynamicToolCall') {
    if (p.item.success !== true || p.item.status !== 'completed') {
      rejectProtocol('Tool result failed'); return;
    }
    completed.add(p.item.id);
  }
  if (m.method === 'item/completed' && p.item?.type === 'agentMessage')
    active.text = p.item.text ?? active.text;
  if (m.method === 'turn/completed') {
    finishedTurns.add(observedTurn);
    active.completed += 1;
    if (p.turn?.status !== 'completed') rejectProtocol('Turn not completed');
    else active.resolve({text:active.text,delta:active.delta});
  }
}
readline.createInterface({input:child.stdout}).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id != null && !m.method) {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    if (m.error) { p.reject(new Error('RPC_FAILED')); return; }
    if (p.method === 'turn/start') {
      if (!active || typeof m.result?.turn?.id !== 'string' || finishedTurns.has(m.result.turn.id)) {
        rejectProtocol('Missing/reused turn ID');
        p.reject(protocolFailure); return;
      }
      active.turnId = m.result.turn.id;
      for (const buffered of active.buffer.splice(0)) handleTurnMessage(buffered);
    }
    p.resolve(m.result);
    return;
  }
  handleTurnMessage(m);
});
function rpc(method, params) {
  const id = ++seq;
  return new Promise((resolve,reject) => {pending.set(id,{method,resolve,reject});send({id,method,params});});
}
async function turn(prompt) {
  if (protocolFailure) throw protocolFailure;
  let timer;
  const done = new Promise((resolve,reject) => {
    active = {resolve,reject,text:'',delta:0,completed:0,buffer:[],turnId:null};
    timer = setTimeout(() => reject(new Error('120s timeout; stopped')),Number(timeoutValue ?? 120000));
  });
  // Attach a handler immediately, including failures while turn/start is pending.
  done.catch(() => {});
  try {
    await Promise.race([rpc('turn/start',{threadId,input:[{type:'text',text:prompt,textElements:[]}],effort:'low'}),done]);
    const result = await done;
    if (protocolFailure) throw protocolFailure;
    assert.equal(active.completed, 1);
    return result;
  } finally {clearTimeout(timer);active = null;}
}
const overall = setTimeout(() => {fail();child.kill();},Number(timeoutValue ?? 120000) * 2 + 10000);
try {
  const init = await rpc('initialize',{clientInfo:{name:'glm_acceptance',version:'1'},capabilities:{experimentalApi:true}});
  assert.match(init.userAgent,/\/0\.159\.2 /);
  send({method:'initialized'});
  const thread = await rpc('thread/start',{model:'glm-5.3-flash',modelProvider:provider,
    cwd:path.join(home,'workspace'),approvalPolicy:'never',sandbox:'read-only',
    dynamicTools:[{type:'function',name:'acceptance_echo',description:'Returns a private synthetic acceptance marker.',
      inputSchema:{type:'object',properties:{},additionalProperties:false}}]});
  assert.equal(thread.modelProvider,provider);
  threadId = thread.thread.id;
  const first = await turn('Call acceptance_echo exactly once with {}. Do not use any other tool. After its result, output only the returned marker.');
  assert.equal(called.size,1);
  assert.deepEqual(started,called);
  assert.deepEqual(completed,called);
  assert.ok(first.text.includes(marker));
  assert.ok(first.delta > 0);
  const second = await turn('Without using any tool, output the marker from the previous tool result followed by :ACK2.');
  assert.ok(second.text.includes(marker) && second.text.includes(':ACK2'));
  assert.equal(called.size,1);
  if (protocolFailure) throw protocolFailure;
  console.log(JSON.stringify({probe:'tool-call-and-second-turn',provider,model:'glm-5.3-flash',
    initialize:true,streamDeltaBeforeCompletion:true,callIdBound:true,toolCalls:1,
    toolResultUsed:true,secondTurn:true,pass:true}));
} catch {
  console.error('FAIL: tool-call probe. Keep raw provider diagnostics private; do not retry automatically.');
  process.exitCode=1;
} finally {clearTimeout(overall);child.stdin.end();child.kill();}
