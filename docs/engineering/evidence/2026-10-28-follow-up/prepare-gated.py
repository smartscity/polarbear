from pathlib import Path
root=Path('/private/tmp/polarbear-perf-1028')
(root/'node_modules').symlink_to('/Users/liyunlong/Documents/Smartscity/node_modules')
s=(root/'candidate/apps/desktop/scripts/measure-editor.mjs').read_text()
s=s.replace('for (let round = 0; round < 6; round++) {','''for (let round = 0; round < 6; round++) {
      if (round === 1) {
        await writeFile(output + ".ready", "warmup completed");
        const idleDeadline = Date.now() + 90_000;
        for (;;) {
          try { await readFile(output + ".resume"); break; } catch {}
          if (Date.now() > idleDeadline) throw new Error("Quiet sampling admission timed out");
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }''')
(root/'measure-gated.mjs').write_text(s)
s=(root/'measure-strict.py').read_text().split('time.sleep(10)')[0]
s=s.replace("e=root/'evidence/strict-focus';e.mkdir(parents=True)","e=root/'evidence/gated-focus';e.mkdir(parents=True)")
s+='''
time.sleep(10)
pre=[]
for _ in range(3):pre.append(snapshot());time.sleep(2)
(e/'preflight.json').write_text(json.dumps(pre,indent=2))
if any(x['risks'] for x in pre):raise SystemExit('Busy preflight; no measurement started')
for version,label in [('candidate','B'),('baseline','A')]:
 report=e/(label+'.json');log=(e/(label+'.txt')).open('w');runenv=env.copy();runenv['POLARBEAR_PERF_FIXTURES']='1MiB'
 args=['node',str(root/'measure-gated.mjs'),str(root/version),str(report),label]
 p=subprocess.Popen(args,env=runenv,stdout=log,stderr=subprocess.STDOUT,cwd=root/version)
 print('START',label,flush=True);samples=[];quiet=0;admitted=False;invalid=False;start=time.time()
 while p.poll() is None:
  sample=snapshot(p.pid);sample['phase']='measurement' if admitted else 'startup-or-idle-gate';samples.append(sample)
  if admitted and sample['risks']:invalid=True;p.terminate();break
  if not admitted and Path(str(report)+'.ready').exists():
   quiet=quiet+1 if not sample['risks'] else 0
   if quiet>=3:
    admitted=True;Path(str(report)+'.resume').write_text('Three consecutive quiet snapshots; start measured rounds')
    print('ADMITTED',label,flush=True)
  if time.time()-start>150:invalid=True;p.terminate();break
  time.sleep(1)
 try:code=p.wait(timeout=10)
 except subprocess.TimeoutExpired:p.kill();code=p.wait()
 log.close();(e/(label+'-load.json')).write_text(json.dumps({'command':args,'returncode':code,'admitted':admitted,'invalidExternalLoadOrTimeout':invalid,'samples':samples},indent=2))
 print('DONE',label,code,flush=True)
 if invalid or code or not admitted:break
 time.sleep(10)
'''
(root/'measure-gated.py').write_text(s)
