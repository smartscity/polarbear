import { test } from "node:test";
import assert from "node:assert/strict";
import { pcm16FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";

const handshake = `console.log(JSON.stringify({type:'ready',protocol:1,backend:'cpu'}));`;
function run(source, options = {}, pcm = Buffer.alloc(32000)) {
  return recognizeFixture(process.execPath, ["-e", source], pcm, { name: "fixture", timeoutMs: 3000, ...options });
}

test("validates fixture format and rejects truncated WAV chunks", () => {
  const wav = Buffer.alloc(48);
  wav.write("RIFF"); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(4, 40);
  assert.equal(pcm16FromWav(wav).length, 4);
  assert.throws(() => pcm16FromWav(wav.subarray(0, 47)), /Truncated WAV/);
  wav.writeUInt32LE(48000, 24);
  assert.throws(() => pcm16FromWav(wav));
});

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

test("paces PCM against the sample clock and measures final latency", async () => {
  const result = await run(`${handshake}
    const started=performance.now(); let bytes=0;
    process.stdin.on('data',b=>bytes+=b.length);
    process.stdin.on('end',()=>{
      if(performance.now()-started<900 || bytes===0) process.exit(9);
      console.log(JSON.stringify({type:'final',endMs:1000,english:'fixture'}));
      console.log(JSON.stringify({type:'stopped'}));
    });`, { realtime: true });
  assert.equal(result.code, 0);
  assert.ok(result.maxWriteLagMs < 1000);
  assert.equal(result.finalLagMs.length, 1);
  assert.ok(Number.isFinite(result.finalLagMs[0]));
});

test("stops paced feeding when the helper exits early", async () => {
  const result = await run(`${handshake} process.stdin.once('data',()=>process.exit(7));`, { realtime: true });
  assert.equal(result.code, 7);
  assert.ok(result.elapsedMs < 2000);
});

test("does not expose arbitrary stderr or recognized content in progress", async () => {
  const progress=[];
  await run(`${handshake} console.error('private model path');console.log(JSON.stringify({type:'final',english:'private speech'}));process.stdin.resume();`, { onProgress: p=>progress.push(p) });
  assert.doesNotMatch(JSON.stringify(progress), /private/);
});

test("accepts only numeric diagnostic fields and never forwards private extras", async () => {
  const progress = [];
  const result = await run(`${handshake}
    console.error('caption-metric:' + JSON.stringify({stage:'config',availableCpus:3,threads:2,secret:'private'}));
    console.error('caption-metric:' + JSON.stringify({stage:'final',audioMs:2000,queueMs:12,computeMs:30,cancelled:false,result:0,english:'private'}));
    console.error('caption-metric:' + JSON.stringify({stage:'partial',audioMs:1000,queueMs:0,computeMs:12,cancelled:true,result:-6}));
    console.error('caption-metric:' + JSON.stringify({stage:'vad',frames:'private',computeMs:10}));
    console.error('caption-metric:invalid');
    process.stdin.resume();`, { onProgress: p => progress.push(p) });
  assert.equal(result.metrics.length, 3);
  assert.equal(result.metrics[2].result, -6);
  assert.deepEqual(result.metrics[0], { stage: "config", availableCpus: 3, threads: 2 });
  assert.doesNotMatch(JSON.stringify(progress), /private|secret|english/);
});
