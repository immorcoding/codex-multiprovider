// The only mock boundary is the external Responses HTTP service.
import http from 'node:http';

export const mockKey = 'glm-acceptance-mock-upstream-key-DO-NOT-LOG';

function textEvents(text) {
  const item = { type: 'message', id: 'acceptance-message', role: 'assistant', content: [{ type: 'output_text', text }] };
  return [
    { type: 'response.created', response: { id: 'acceptance-response', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', item: { ...item, content: [] } },
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id: 'acceptance-response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
}

export async function startMockProvider(scenario = 'success') {
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const bytes of request) raw += bytes;
    const body = JSON.parse(raw);
    if (scenario === 'slow') {
      const timer = setTimeout(() => response.end(), 60_000);
      response.once('close', () => clearTimeout(timer));
      return;
    }
    if (request.headers.authorization !== 'Bearer ' + mockKey || scenario === 'secret-error') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'private-provider-body ' + mockKey } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const lastUser = body.input?.filter(item => item.role === 'user').at(-1);
    const prompt = (lastUser?.content ?? []).map(item => item.text ?? '').join('');
    const marker = raw.match(/probe-[a-f0-9]{16}/)?.[0];
    let events;
    if (prompt.includes('Call acceptance_echo') && !marker) {
      const item = { type: 'function_call', id: 'fn1', call_id: 'call-acceptance', name: 'acceptance_echo', arguments: '{}' };
      events = [
        { type: 'response.created', response: { id: 'tool-response', status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', item },
        { type: 'response.output_item.done', item },
        { type: 'response.completed', response: { id: 'tool-response', status: 'completed', output: [item] } },
      ];
    } else {
      const text = prompt.includes('ACK_PY') ? 'ACK_PY' : prompt.includes('token I asked') && raw.includes('PY_ACCEPTANCE') ? 'PY_ACCEPTANCE' :
        prompt.includes('ACK_TS') ? 'ACK_TS' : prompt.includes('token I asked') && raw.includes('TS_ACCEPTANCE') ? 'TS_ACCEPTANCE' :
        marker ? marker + (prompt.includes('ACK2') ? ':ACK2' : '') : 'ACK_VERIFY';
      events = textEvents(text);
    }
    for (const event of events) {
      if (scenario === 'missing-completed' && event.type === 'response.completed') continue;
      response.write('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n');
    }
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { baseUrl: 'http://127.0.0.1:' + server.address().port + '/api/v1',
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
