import { test } from "node:test";
import assert from "node:assert/strict";
import { pcm16FromWav, float32FromWav, recognizeFixture } from "./caption-engine-fixture.mjs";

const handshake = `console.log(JSON.stringify({type:'ready',protocol:1,backend:'cpu'}));`;
// Protocol fixtures include host process startup; ASR latency gates use separate real-engine measurements.
function run(source, options = {}, pcm = Buffer.alloc(32000)) {
  return recognizeFixture(process.execPath, ["-e", source], pcm, { name: "fixture", timeoutMs: 15000, ...options });
}

test("does not treat a three-second host bootstrap delay as a protocol failure", { timeout: 15000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = await run(`${handshake}
    process.stdin.resume();
    process.stdin.on('end',()=>console.log(JSON.stringify({type:'stopped'})));`, {
    onProgress: progress => {
      if (progress.phase === "starting") queueMicrotask(() => t.mock.timers.tick(3001));
    },
  });
  assert.equal(result.code, 0);
  assert.equal(result.events.at(-1).type, "stopped");
});

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

test("replays diagnostic float WAV samples without quantizing them", async () => {
  const wav = Buffer.alloc(56);
  wav.write("RIFF"); wav.writeUInt32LE(48, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(3, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt16LE(32, 34);
  wav.write("data", 36); wav.writeUInt32LE(12, 40);
  wav.writeFloatLE(0.000001, 44); wav.writeFloatLE(-0.25, 48); wav.writeFloatLE(0.5, 52);
  const pcm = float32FromWav(wav);
  const result = await run(`${handshake}
    const chunks=[]; process.stdin.on('data', b=>chunks.push(b));
    process.stdin.on('end',()=>{
      const data=Buffer.concat(chunks);
      if(data.readUInt32LE(8)!==3 || data.readFloatLE(12)!==Math.fround(0.000001) || data.readFloatLE(16)!==-0.25) process.exit(9);
      console.log(JSON.stringify({type:'stopped'}));
    });`, { pcmFormat: "float32" }, pcm);
  assert.equal(result.code, 0);
  assert.throws(() => pcm16FromWav(wav));
  assert.throws(() => float32FromWav(wav.subarray(0, 55)));
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

test("preserves every sample and timestamp across irregular packet boundaries", async () => {
  const pcm = Buffer.alloc(5633 * 2);
  for (let index = 0; index < 5633; index++) pcm.writeInt16LE(index, index * 2);
  const result = await run(`
    ${handshake}
    const chunks=[];
    process.stdin.on('data', chunk=>chunks.push(chunk));
    process.stdin.on('end',()=>{
      const data=Buffer.concat(chunks); let offset=0,samples=0,packet=0;
      const sizes=[100,413,4096];
      while(offset<data.length){
        const count=data.readUInt32LE(offset+8);
        if(count!==Math.min(sizes[packet++%sizes.length],5633-samples)) process.exit(9);
        if(data.readBigUInt64LE(offset)!==BigInt(Math.floor(samples/16))) process.exit(10);
        for(let index=0;index<count;index++){
          if(data.readFloatLE(offset+12+index*4)!==(samples+index)/32768) process.exit(11);
        }
        samples+=count; offset+=12+count*4;
      }
      if(samples!==5633 || offset!==data.length) process.exit(12);
      console.log(JSON.stringify({type:'stopped'}));
    });
  `, { packetSamples: [100, 413, 4096] }, pcm);
  assert.equal(result.code, 0);
});

test("rejects invalid packet patterns before spawning a helper", () => {
  for (const packetSamples of [[], [0], [-1], [4097], [1.5]]) {
    assert.throws(() => run("process.exit(0)", { packetSamples }));
  }
});

async function expectPhaseTimeout(t, source, phase) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reached = false;
  const result = run(source, { timeoutMs: 1000, onProgress: progress => {
    if (!reached && progress.phase === phase) {
      reached = true;
      t.mock.timers.tick(1000);
    }
  } });
  // Even a failed readiness assertion must reap the real child before restoring timers.
  t.after(async () => { t.mock.timers.tick(1000); await result.catch(() => {}); });
  await assert.rejects(result, new RegExp(`Caption engine timeout; phase=${phase}`));
  assert.ok(reached);
}

test("kills and reaps a helper stalled during model loading with phase diagnostics", { timeout: 15000 }, async t => {
  await expectPhaseTimeout(t, `console.error('caption-phase:loading-asr-cpu'); setInterval(()=>{},100);`, "loading-asr-cpu");
});

test("distinguishes an inference stall from a startup stall", { timeout: 15000 }, async t => {
  await expectPhaseTimeout(t, `${handshake} process.stdin.resume(); process.stdin.on('end',()=>console.error('caption-phase:recognizing-final')); setInterval(()=>{},100);`, "recognizing-final");
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
    console.error('caption-metric:' + JSON.stringify({stage:'final',audioMs:2000,queueMs:12,computeMs:30,cancelled:false,result:0,sequence:2,startMs:100,endMs:2100,textEmitted:true,english:'private'}));
    console.error('caption-metric:' + JSON.stringify({stage:'partial',audioMs:1000,queueMs:0,computeMs:12,cancelled:true,result:-6}));
    console.error('caption-metric:' + JSON.stringify({stage:'vad',frames:'private',computeMs:10}));
    console.error('caption-metric:invalid');
    process.stdin.resume();`, { onProgress: p => progress.push(p) });
  assert.equal(result.metrics.length, 3);
  assert.equal(result.metrics[2].result, -6);
  assert.equal(result.metrics[1].sequence, 2);
  assert.equal(result.metrics[1].textEmitted, true);
  assert.deepEqual(result.metrics[0], { stage: "config", availableCpus: 3, threads: 2 });
  assert.doesNotMatch(JSON.stringify(progress), /private|secret|english/);
});
