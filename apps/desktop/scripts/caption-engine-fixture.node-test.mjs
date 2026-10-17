import { test } from "node:test";
import assert from "node:assert/strict";
import { recognizeFixture } from "./caption-engine-fixture.mjs";

const handshake = `console.log(JSON.stringify({type:'ready',protocol:1,backend:'cpu'}));`;
function run(source, options = {}, pcm = Buffer.alloc(32000)) {
  return recognizeFixture(process.execPath, ["-e", source], pcm, { name: "fixture", timeoutMs: 3000, ...options });
}

test("feeds timestamped PCM with an empty environment and waits for EOF", async () => {
  const result = await run(`
    if (process.env.PATH) process.exit(8);
    ${handshake}
    const chunks=[];
    process.stdin.on('data', chunk=>chunks.push(chunk));
    process.stdin.on('end',()=>{
      const data=Buffer.concat(chunks); let offset=0,samples=0;
      while(offset<data.length){
        const count=data.readUInt32LE(offset+8);
        if(count>512 || count===0 || data.readBigUInt64LE(offset)!==BigInt(Math.floor(samples*1000/16000))) process.exit(9);
        samples+=count; offset+=12+count*4;
      }
      if(samples!==16000 || offset!==data.length) process.exit(10);
      console.log(JSON.stringify({type:'stopped'}));
    });
  `);
  assert.equal(result.code, 0);
  assert.equal(result.events.at(-1).type, "stopped");
});

test("kills and reaps a helper stalled during model loading with phase diagnostics", async () => {
  await assert.rejects(run(`console.error('caption-phase:loading-asr-cpu'); setInterval(()=>{},100);`, { timeoutMs: 1000 }), /Caption engine timeout; phase=loading-asr-cpu/);
});

test("distinguishes an inference stall from a startup stall", async () => {
  await assert.rejects(run(`${handshake} process.stdin.resume(); process.stdin.on('end',()=>console.error('caption-phase:recognizing-final')); setInterval(()=>{},100);`, { timeoutMs: 1000 }), /Caption engine timeout; phase=recognizing-final/);
});

test("rejects an early engine exit instead of waiting for the timeout", async () => {
  await assert.rejects(run("process.exit(3)"), /incomplete engine session.*code=3/);
});

test("rejects malformed and oversized events without uncaught parser errors", async () => {
  await assert.rejects(run("console.log('not json');setInterval(()=>{},100)"), /Invalid JSON event/);
  await assert.rejects(run("process.stdout.write('x'.repeat(70000));setInterval(()=>{},100)"), /Protocol output limit exceeded/);
});

test("requires the same CPU handshake used in production", async () => {
  await assert.rejects(run("console.log(JSON.stringify({type:'ready',protocol:1,backend:'metal'}));setInterval(()=>{},100)"), /Invalid engine handshake/);
});

test("preserves the malformed frame exit code", async () => {
  const result = await run(`${handshake} process.stdin.once('data',b=>process.exit(b.readUInt32LE(8)===5000?4:9));`, { invalid: true });
  assert.equal(result.code, 4);
});

test("does not expose arbitrary stderr or recognized content in progress", async () => {
  const progress=[];
  await run(`${handshake} console.error('private model path');console.log(JSON.stringify({type:'final',english:'private speech'}));process.stdin.resume();`, { onProgress: p=>progress.push(p) });
  assert.doesNotMatch(JSON.stringify(progress), /private/);
});
