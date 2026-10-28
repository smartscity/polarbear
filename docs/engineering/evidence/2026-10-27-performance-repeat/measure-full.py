import subprocess,json,time,os,datetime
from pathlib import Path
root=Path('/private/tmp/polarbear-perf-1027');e=root/'evidence/attempt-4';e.mkdir()
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
pre=[snapshot()]
for _ in range(2):time.sleep(3);pre.append(snapshot())
(e/'preflight.json').write_text(json.dumps(pre,indent=2))
if any(s['risks'] for s in pre):raise SystemExit('Busy preflight; no measurement started')
plan=[('baseline','full-A',None),('candidate','full-B',None)]
for version,label,fixtures in plan:
 report=e/(label+'.json');log=(e/(label+'.log')).open('w');args=['node',str(root/'candidate/apps/desktop/scripts/measure-editor.mjs'),str(root/version),str(report),label]
 runenv=env.copy()
 if fixtures:runenv['POLARBEAR_PERF_FIXTURES']=fixtures
 print('START',label,flush=True)
 p=subprocess.Popen(args,env=runenv,stdout=log,stderr=subprocess.STDOUT,cwd=root/version)
 samples=[];streak=0;invalid=False
 while p.poll() is None:
  sample=snapshot(p.pid);samples.append(sample);streak=streak+1 if sample['risks'] else 0
  if streak>=3:
   invalid=True;p.terminate();print('STOP external load',label,flush=True);break
  time.sleep(1)
 try:code=p.wait(timeout=10)
 except subprocess.TimeoutExpired:p.kill();code=p.wait()
 log.close();(e/(label+'-load.json')).write_text(json.dumps({'command':args,'returncode':code,'invalidExternalLoad':invalid,'samples':samples},indent=2))
 print('DONE',label,code,flush=True)
 if invalid or code:break
