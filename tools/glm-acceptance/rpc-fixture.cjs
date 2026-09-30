// External JSON-RPC transport fault fixture; never a substitute for the pinned CLI acceptance.
const fs = require('node:fs');
const readline = require('node:readline');
const scenario = fs.readFileSync('scenario.txt', 'utf8');
const emit = message => process.stdout.write(JSON.stringify(message) + '\n');
let turn = 0;
let marker;
function finish(id, text) {
  emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-fixture', turnId: id, delta: text } });
  emit({ method: 'turn/completed', params: { threadId: 'thread-fixture', turn: { id, status: 'completed' } } });
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') emit({ id: message.id, result: { userAgent: 'fixture/0.159.2 Windows' } });
  if (message.method === 'thread/start') emit({ id: message.id, result: { modelProvider: 'fixture', thread: { id: 'thread-fixture' } } });
  if (message.method === 'turn/start') {
    turn += 1;
    emit({ id: message.id, result: { turn: { id: 'turn-' + turn } } });
    if (turn === 1) {
      emit({ method: 'item/started', params: { threadId: 'thread-fixture', turnId: 'turn-1', item: { type: 'dynamicToolCall', id: 'fixture-call' } } });
      emit({ id: 100, method: 'item/tool/call', params: { threadId: 'thread-fixture', turnId: scenario === 'wrong-tool-turn' ? 'stale-turn' : 'turn-1', callId: 'fixture-call', tool: 'acceptance_echo', arguments: {} } });
    } else finish(scenario === 'wrong-completion' ? 'turn-1' : 'turn-2', marker + ':ACK2');
  }
  if (message.id === 100 && message.result) {
    marker = message.result.contentItems[0].text;
    emit({ method: 'item/completed', params: { threadId: 'thread-fixture', turnId: 'turn-1', item: { type: 'dynamicToolCall', id: 'fixture-call', success: true, status: 'completed' } } });
    finish('turn-1', marker);
  }
});
