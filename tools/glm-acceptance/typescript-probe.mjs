// @ts-check
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Codex} from '../sdk/node_modules/@openai/codex-sdk/dist/index.js';
const [binary,home,keyName,timeoutValue] = process.argv.slice(2);
assert.ok(binary && home && keyName && process.env[keyName],'Missing arguments/key');
/** @type {Record<string, string>} */
const env={};
for(const k of ['SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC'])
  if(process.env[k])env[k]=process.env[k];
for(const k of ['USERPROFILE','HOME','APPDATA','LOCALAPPDATA','CODEX_HOME'])env[k]=home;
env[keyName]=process.env[keyName];
const sdkVersion=JSON.parse(readFileSync(new URL('../sdk/node_modules/@openai/codex-sdk/package.json',import.meta.url),'utf8')).version;
assert.equal(sdkVersion,'0.159.2');
const codex=new Codex({codexPathOverride:binary,env});
/** @type {import('../sdk/node_modules/@openai/codex-sdk/dist/index.js').ThreadOptions} */
const options={model:'glm-5.3-flash',workingDirectory:home+'/workspace',
  skipGitRepoCheck:true,approvalPolicy:'never',sandboxMode:'read-only'};
try {
  const thread=codex.startThread(options);
  const {events}=await thread.runStreamed('Remember token TS_ACCEPTANCE. Do not use tools. Reply only ACK_TS.',
    {signal:AbortSignal.timeout(Number(timeoutValue ?? 120000))});
  let answer='',completed=0,items=0;
  for await(const e of events){
    if(e.type==='turn.failed'||e.type==='error')throw Error('Failed');
    if(e.type==='item.completed' && e.item.type==='agent_message'){answer+=e.item.text;items++;}
    if(e.type==='turn.completed')completed++;
  }
  assert.equal(completed,1);assert.ok(items>0&&answer.includes('ACK_TS')&&thread.id);
  const result=await codex.resumeThread(thread.id,options).run('Do not use tools. Reply only the token I asked you to remember.',
    {signal:AbortSignal.timeout(Number(timeoutValue ?? 120000))});
  assert.ok(result.finalResponse.includes('TS_ACCEPTANCE'));
  console.log(JSON.stringify({probe:'typescript-sdk',sdkVersion,streamConsumed:true,completed:1,persistedResume:true,pass:true}));
}catch{
  console.error('FAIL: TypeScript live probe; inspect privately, no automatic retry.');process.exitCode=1;
}
