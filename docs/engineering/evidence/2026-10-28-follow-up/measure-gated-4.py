import subprocess,json,time,os,datetime
from pathlib import Path
root=Path('/private/tmp/polarbear-perf-1028');e=root/'evidence/gated-focus-4';e.mkdir(parents=True)
env=os.environ.copy();env['PATH']='/Users/liyunlong/.nvm/versions/node/v26.1.0/bin:'+env['PATH']
def snapshot(owned=None):
 rows=[]
 for line in subprocess.check_output(['ps','-axo','pid=,ppid=,pcpu=,comm='],text=True).splitlines():
  parts=line.split(None,3)
  if len(parts)==4:rows.append(dict(pid=int(parts[0]),ppid=int(parts[1]),cpu=float(parts[2]),command=parts[3]))
 owned_ids={owned} if owned else set()
 for _ in range(8):owned_ids.update(r['pid'] for r in rows if r['ppid'] in owned_ids)
 external=[r for r in rows if r['pid'] not in owned_ids and r['pid']!=os.getpid()]
 risks=[r for r in external if (any(n in r['command'] for n in ['/rustc','/clang','/swift-frontend','/ld']) and r['cpu']>5) or (any(n in r['command'] for n in ['Chrome','WebKit','chromium','Playwright']) and r['cpu']>20) or r['cpu']>50]
 return dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),risks=risks,top=sorted(external,key=lambda r:-r['cpu'])[:12])

time.sleep(10)
pre=[];quiet=0;deadline=time.time()+90
while time.time()<deadline:
 sample=snapshot();pre.append(sample);quiet=quiet+1 if not sample['risks'] else 0
 if quiet>=3:break
 time.sleep(2)
(e/'preflight.json').write_text(json.dumps(pre,indent=2))
if quiet<3:raise SystemExit('Busy preflight; no measurement started')
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
