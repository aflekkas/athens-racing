#!/usr/bin/python3.12
"""Task-local bounded diagnostic; no world admission or process-phase handoff."""
# External -I -S -B is mandatory BEFORE startup. This check is defense in
# depth; it cannot undo a hook executed by an incorrectly launched interpreter.
import sys
if __name__=='__main__' and not (sys.flags.isolated and sys.flags.ignore_environment and sys.flags.no_site and sys.flags.no_user_site and sys.flags.dont_write_bytecode and sys.flags.safe_path):
    sys.stderr.write('Requires external /usr/bin/python3.12 -I -S -B startup\n');raise SystemExit(1)
import argparse,hashlib,json,math,os,resource,signal,stat,subprocess,time
from collections import deque
from pathlib import Path
BASE=Path('/tmp/athens-greenery.98Rc')
CHECKPOINT='6721129cc1cc99dfac81afcfe2c1f60704f77c8b'
PROOF_SHA='d78d5c7889a218b62f5873fa04a5d99d569a566fbedbff1c0d0e5a2bfe611ca2'
TARGET_SHA='d3fc0efacc9ddeaba0fd3565ffa1127d0306e4d3081c7cca2876b35ca00d9b8d'
ROOT=Path('/home/dev/.cogenly/worktrees/athens-racing/t3-41c48689')
MAX=67108864
NODE='/usr/bin/node'
PYTHON='/usr/bin/python3.12'
def child_environment():
    # No inherited environment, PATH, HOME, Node/Python runtime knobs, dynamic
    # loader variables or secrets. Grant is set only from validated CLI marker.
    return {'ATHENS_SINGLE15_ENVELOPE_GRANT':'6721129','TMPDIR':str(BASE),'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','TZ':'UTC'}
def node_command(worker,encoded):
    return [NODE,'--max-old-space-size=48','--max-semi-space-size=4','--input-type=module','-e',worker.decode('utf8'),'--','--execute-envelope','--payload-bytes',str(len(encoded)),'--payload-sha',hashlib.sha256(encoded).hexdigest()]
def validate_controller_startup():
    if os.path.realpath(sys.executable)!=PYTHON:raise Stop('absolute Python executable pin')
    # Empty exec environment normally gains only Python locale-coercion LC_CTYPE.
    # Anything else means the external clean-exec contract was not followed.
    if any(k!='LC_CTYPE' or v!='C.UTF-8' for k,v in os.environ.items()):raise Stop('external clean-exec environment required')

class Stop(Exception):pass
class Deadline:
    def __init__(self,seconds=90,clock=time.monotonic):self.clock=clock;self.start=clock();self.end=self.start+seconds;self.cpu_start=time.process_time();self.child_cpu_start=resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime+resource.getrusage(resource.RUSAGE_CHILDREN).ru_stime;self.checks=0
    def check(self):
        self.checks+=1
        if self.checks>4096:raise Stop('deadline observation history bound')
        if self.clock()>=self.end-2:raise Stop('total wall deadline including preflight; 2s cleanup reserved')
        children=resource.getrusage(resource.RUSAGE_CHILDREN)
        if time.process_time()-self.cpu_start+children.ru_utime+children.ru_stime-self.child_cpu_start>=60:raise Stop('aggregate reaped/controller CPU soft deadline')
        own=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
        if not isinstance(own,int) or own<=0:raise Stop('controller/preflight kernel RSS missing')
        if own>201326592:raise Stop('controller/preflight RSS cap')
    def remaining(self):return max(0,self.end-self.clock())
class Ledger:
    # All captures/copies/hash contexts/stat/read observations accumulate; no GC
    # release. Native allowances are estimates, not actual allocator measurements.
    def __init__(self):self.used=1048576+4096*1024;self.entries=[]
    def add(self,n,label):
        if not isinstance(n,int) or n<0 or self.used+n>MAX:raise Stop('controller workload before '+label)
        self.used+=n;self.entries.append({'phase':label,'reservedBytes':n,'cumulativeBytes':self.used})
def desc(s):return(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def capture(path,size,expected,deadline,ledger,role):
    deadline.check()
    if not isinstance(size,int) or size<0 or size>4194304 or not isinstance(expected,str) or len(expected)!=64:raise Stop('trusted capture bound: '+role)
    # Two complete raw histories, one native SHA context estimate, observations,
    # readv view/result histories including one EOF; all admitted before alloc.
    ledger.add(2*(size+1)+65536+16384+2048*(math.ceil(size/65536)+1),role)
    before=os.lstat(path);deadline.check()
    if not stat.S_ISREG(before.st_mode) or before.st_size!=size:raise Stop('capture stat/size: '+role)
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        if desc(os.fstat(fd))!=desc(before):raise Stop('capture replacement: '+role)
        deadline.check()
        data=bytearray(size+1);view=memoryview(data);at=0;digest=hashlib.sha256();reads=0
        # A one-byte short-read adversary cannot produce unbounded allocation
        # histories: each extra read is admitted BEFORE readv/view construction.
        planned=math.ceil(size/65536)+1
        while at<size:
            deadline.check();reads+=1
            if reads>planned:ledger.add(2048,role+' extra read')
            n=os.readv(fd,[view[at:min(size,at+65536)]]);deadline.check()
            if n<=0:raise Stop('capture early EOF: '+role)
            digest.update(view[at:at+n]);at+=n
        deadline.check();reads+=1
        if reads>planned:ledger.add(2048,role+' extra EOF')
        if os.readv(fd,[view[size:size+1]])!=0:raise Stop('capture growth: '+role)
        deadline.check()
        after=os.fstat(fd);path_after=os.lstat(path);deadline.check()
        if not stat.S_ISREG(path_after.st_mode) or desc(before)!=desc(after) or desc(before)!=desc(path_after):raise Stop('capture descriptor/path change: '+role)
        if digest.hexdigest()!=expected:raise Stop('capture SHA: '+role)
        return bytes(view[:size])
    finally:os.close(fd)
def parse_capture(data,role,limit=32768):
    if len(data)>limit:raise Stop('JSON capture size before parse: '+role)
    # All parsed inputs here have an external exact SHA. Raw size bounds their
    # conversion/parser histories; add 128B per byte for small trusted metadata.
    return json.loads(data.decode('utf8'))
def validate_target(p):
    o=p.get('original',{});e=o.get('entry',{});s=o.get('source',{})
    if p.get('sourceCheckpoint')!=CHECKPOINT or e.get('sha256')!=TARGET_SHA or e.get('bytes')!=289767 or e.get('decodedBytes')!=4104578 or o.get('cachePath')!='/tmp/athens-loaders.OfMh/cells/'+TARGET_SHA+'.bin.gz' or s!={'world':'athens-east-development','revision':'2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39','cell':[15,-21]}:raise Stop('wrong target/source pin BEFORE original open')
def preflight(plan_path,plan_size,plan_sha,controller_size,controller_sha,worker_sha,deadline,ledger):
    # Capture own executable source too; the Node child executes only captured
    # worker bytes, never a filename that can change after authentication.
    own=Path(__file__);capture(own,controller_size,controller_sha,deadline,ledger,'controller source')
    raw=capture(plan_path,plan_size,plan_sha,deadline,ledger,'plan')
    ledger.add(128*len(raw),'plan UTF8/parse histories');p=parse_capture(raw,'plan');validate_target(p)
    g=p['sourceGraph']
    if g['sha256']!=PROOF_SHA:raise Stop('wrong codeproof pin BEFORE original open')
    proofraw=capture(g['path'],g['bytes'],g['sha256'],deadline,ledger,'codeproof')
    ledger.add(128*len(proofraw),'codeproof UTF8/parse histories');proof=parse_capture(proofraw,'codeproof')
    if proof.get('sourceCheckpoint')!=CHECKPOINT or proof.get('codeProofSha256')!='8a7605689fbf71c0c3a1289085d0d10a9167ed30309adcca1622b174cb07589a':raise Stop('codeproof identity')
    entries=g['files'];deps=proof['code']['dependencies']
    if len(entries)!=53 or len(deps)!=53 or len({r['path'] for r in entries})!=53 or {r['path']:r['sha256'] for r in entries}!=deps:raise Stop('complete trusted source graph mismatch')
    if sum(r['bytes'] for r in entries)>8388608:raise Stop('aggregate trusted source volume')
    for r in entries:
        name=Path(r['path'])
        if name.is_absolute() or '..' in name.parts:raise Stop('code path escape')
        capture(ROOT/name,r['bytes'],r['sha256'],deadline,ledger,'code '+r['path'])
    w=p['execution']['worker'];worker=capture(w['path'],w['bytes'],worker_sha,deadline,ledger,'worker source')
    if worker_sha!=w['sha256']:raise Stop('worker external/plan SHA mismatch')
    deadline.check();return p,worker
class Outputs:
    suffixes=('.stdout.json','.stderr.log','.controller.json','.pid')
    def __init__(self,prefix):
        self.prefix=Path(prefix);self.fds={};self.created={}
        if self.prefix.parent!=BASE or not self.prefix.name.startswith('single-original15-'):raise Stop('owned output prefix required')
        try:
            for suffix in self.suffixes:
                path=Path(str(self.prefix)+suffix);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);self.fds[suffix]=fd;self.created[suffix]=(path,desc(os.fstat(fd)))
        except BaseException:
            self.close()
            for path,identity in self.created.values():
                try:
                    if desc(os.lstat(path))==identity:os.unlink(path)
                except FileNotFoundError:pass
            raise
    def write(self,suffix,data,cap):
        if len(data)>cap:raise Stop('bounded output '+suffix)
        fd=self.fds[suffix];at=0
        while at<len(data):
            n=os.write(fd,data[at:])
            if n<=0:raise Stop('output short write')
            at+=n
    def size(self):return sum(os.fstat(fd).st_size for fd in self.fds.values())
    def close(self):
        for fd in self.fds.values():os.close(fd)
        self.fds={}
# Reused bounded slabs: no full /proc UTF8 string or split-line histories.
_STATUS=bytearray(16385);_STAT=bytearray(8193)
def proc_bytes(path,buffer):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        view=memoryview(buffer);n=os.readv(fd,[view[:-1]])
        if n==len(buffer)-1 and os.readv(fd,[view[-1:]])!=0:raise Stop('proc bound')
        return n
    finally:os.close(fd)
def decimal(buffer,at,end):
    while at<end and buffer[at] in (9,32):at+=1
    start=at;value=0
    while at<end and 48<=buffer[at]<=57:value=value*10+buffer[at]-48;at+=1
    if at==start:raise Stop('proc numeric field')
    return value,at
def proc_status(pid):
    n=proc_bytes('/proc/'+str(pid)+'/status',_STATUS)
    state_at=_STATUS.find(b'State:',0,n);rss_at=_STATUS.find(b'VmRSS:',0,n)
    state=None;rss=None
    if state_at>=0:
        at=state_at+6
        while at<n and _STATUS[at] in (9,32):at+=1
        if at<n:state=chr(_STATUS[at])
    if rss_at>=0:rss=decimal(_STATUS,rss_at+6,n)[0]*1024
    n=proc_bytes('/proc/'+str(pid)+'/stat',_STAT);at=_STAT.rfind(b')',0,n)+2
    # Field3 is state; fields14/15 are CPU ticks. Skip 11 bounded fields.
    if at<2:raise Stop('proc stat syntax')
    for _ in range(11):
        while at<n and _STAT[at]!=32:at+=1
        at+=1
    user,at=decimal(_STAT,at,n);system,at=decimal(_STAT,at,n)
    return {'state':state,'rss':rss,'cpuSeconds':(user+system)/os.sysconf('SC_CLK_TCK')}
def sample_child(proc,reader=proc_status):
    # Missing RSS is NEVER converted to zero. poll() reaps using our own Popen
    # handle; no looked-up PID is ever signalled.
    before=proc.poll()
    if before is not None:return {'state':'REAPED_BEFORE_SAMPLE','rss':None,'uncertain':False,'exit':before}
    try:status=reader(proc.pid)
    except (FileNotFoundError,ProcessLookupError):
        after=proc.poll();return {'state':'EXIT_RACE_MISSING_PROC' if after is not None else 'LIVE_MISSING_PROC','rss':None,'uncertain':True,'exit':after}
    after=proc.poll()
    if status.get('state')=='Z':return {'state':'ZOMBIE_AWAIT_REAP','rss':None,'uncertain':True,'exit':after}
    if after is not None:return {'state':'EXIT_DURING_SAMPLE','rss':status.get('rss'),'uncertain':True,'exit':after}
    value=status.get('rss')
    if not isinstance(value,int) or value<=0:return {'state':'LIVE_MISSING_RSS','rss':None,'uncertain':True,'exit':None}
    return {'state':'ALIVE_SAMPLED','rss':value,'cpuSeconds':status.get('cpuSeconds'),'uncertain':False,'exit':None}
def close_child(proc):
    actions=[]
    if proc.poll() is None:
        proc.terminate();actions.append('TERM_OWN_CHILD')
        try:proc.wait(timeout=1)
        except subprocess.TimeoutExpired:proc.kill();actions.append('KILL_OWN_CHILD');proc.wait(timeout=1)
    else:proc.wait(timeout=1)
    return {'closed':proc.poll() is not None,'exit':proc.returncode,'actions':actions}
def monitor(proc,outputs,deadline,reader=proc_status,sleep=time.sleep):
    peak=None;events=deque(maxlen=8);uncertain=False;reason=None;samples=0;observed=0
    try:
        while True:
            deadline.check();samples+=1
            if samples>1802:raise Stop('monitor observation history bound')
            sample=sample_child(proc,reader);events.append(sample)
            if sample['uncertain']:uncertain=True;reason=sample['state'];break
            if sample['state']=='REAPED_BEFORE_SAMPLE':
                if not observed:uncertain=True;reason='EXIT_BEFORE_ANY_LIVE_RSS_SAMPLE'
                break
            observed+=1
            parent=reader(os.getpid());prss=parent.get('rss')
            if not isinstance(prss,int) or prss<=0:uncertain=True;reason='CONTROLLER_MISSING_RSS';break
            peak=max(peak or 0,prss+sample['rss'])
            cpu=sample.get('cpuSeconds')
            if not isinstance(cpu,(int,float)) or cpu<0:uncertain=True;reason='CHILD_CPU_UNAVAILABLE';break
            if cpu+time.process_time()-deadline.cpu_start>=60:reason='aggregate CPU soft deadline';break
            if peak>201326592:reason='aggregate RSS cap';break
            if outputs.size()>114688:reason='aggregate output cap';break
            sleep(.05)
    except BaseException as e:reason=str(e);uncertain=True
    finally:
        try:cleanup=close_child(proc)
        except BaseException as e:cleanup={'closed':False,'error':str(e)};uncertain=True
    return {'stopReason':reason,'rssUncertain':uncertain,'resourceCapacityClaim':False,'resourceCheckPassed':False if uncertain or reason else True,'sampledCombinedRSSPeak':peak,'events':list(events),'observationCount':samples,'aliveRSSObservations':observed,'cleanup':cleanup}
def aggregate_cpu_limits(used):
    # Integer RLIMITs partition the TWO processes' hard CPU ceilings. Reserve
    # two whole seconds above current controller consumption for monitoring and
    # cleanup; Node inherits the old 65s hard ceiling until preexec lowers it.
    if not isinstance(used,(int,float)) or not math.isfinite(used) or used<0:raise Stop('CPU accounting input')
    parent_hard=math.ceil(used)+2;child_hard=65-parent_hard;child_soft=min(child_hard,60-parent_hard)
    if child_soft<1:raise Stop('CPU capacity before child launch')
    return (parent_hard-1,parent_hard),(child_soft,child_hard)
def child_limits(cpu):
    resource.setrlimit(resource.RLIMIT_CPU,cpu);resource.setrlimit(resource.RLIMIT_FSIZE,(32768,32768))
def main(argv=None):
    deadline=Deadline() # BEFORE argument parsing, output reservations or source preflight.
    # Work receives 88s; reserve the final 2s for TERM/KILL/wait and receipt.
    def alarm(which,_frame):raise Stop('CPU soft ceiling; cleanup reserved' if which==signal.SIGXCPU else '88s outer work alarm; 2s cleanup reserved')
    signal.signal(signal.SIGALRM,alarm);signal.signal(signal.SIGXCPU,alarm);signal.setitimer(signal.ITIMER_REAL,88)
    parser=argparse.ArgumentParser();parser.add_argument('--grant-marker',required=True,choices=['6721129']);parser.add_argument('--plan',required=True);parser.add_argument('--plan-bytes',required=True,type=int);parser.add_argument('--plan-sha',required=True);parser.add_argument('--controller-bytes',required=True,type=int);parser.add_argument('--controller-sha',required=True);parser.add_argument('--worker-sha',required=True);parser.add_argument('--output-prefix',required=True);args=parser.parse_args(argv)
    validate_controller_startup()
    if args.grant_marker!='6721129':raise Stop('explicit future grant marker required')
    if tuple(sys.version_info[:3])!=(3,12,3) or sys.platform!='linux' or os.uname().machine!='x86_64':raise Stop('controller native-accounting runtime mismatch')
    resource.setrlimit(resource.RLIMIT_CPU,(60,65))
    ledger=Ledger();out=Outputs(args.output_prefix);proc=None;result={'status':'STOP-FAIL-CLOSED','passed':False,'resourceCapacityClaim':False,'originalCellAdmission':False,'cell':[15,-21],'phase':'source preflight','originalChildLaunches':0}
    try:
        p,worker=preflight(args.plan,args.plan_bytes,args.plan_sha,args.controller_bytes,args.controller_sha,args.worker_sha,deadline,ledger)
        result['sourceProof']={'checkpoint':CHECKPOINT,'planSha256':args.plan_sha,'codeProofRawSha256':PROOF_SHA,'verifiedSourceFiles':53,'controllerSha256':args.controller_sha,'workerSha256':args.worker_sha}
        # Histories for <=1801 monitor samples, result/error/IPC serialization,
        # argv copies, and trusted worker bootstrap. None gets GC release credit.
        ledger.add(1802*8192+1048576,'monitor/IPC/output histories')
        payload={'sourceCheckpoint':p['sourceCheckpoint'],'original':p['original'],'controllerReservedBytes':ledger.used,'knownOtherRetainedFloor':33266790+905217+p['sourceGraph']['readReservationBytes']}
        encoded=json.dumps(payload,separators=(',',':')).encode();deadline.check()
        if len(encoded)>32768:raise Stop('payload bound before child')
        if ledger.used+3145728+2*289767+65536+3*4104578>MAX:raise Stop('combined controller/initial child budget BEFORE launch')
        deadline.check();parent_cpu,child_cpu=aggregate_cpu_limits(time.process_time());result['cpuRlimits']={'controller':parent_cpu,'child':child_cpu,'aggregateHardSeconds':sum((parent_cpu[1],child_cpu[1]))};result['phase']='owned envelope child';proc=subprocess.Popen(node_command(worker,encoded),executable=NODE,stdin=subprocess.PIPE,stdout=out.fds['.stdout.json'],stderr=out.fds['.stderr.log'],env=child_environment(),cwd=str(BASE),close_fds=True,preexec_fn=lambda:child_limits(child_cpu))
        result['originalChildLaunches']=1;result['pidStartedHere']=proc.pid
        out.write('.pid',(str(proc.pid)+'\n').encode(),64);resource.setrlimit(resource.RLIMIT_CPU,parent_cpu);proc.stdin.write(encoded);proc.stdin.close()
        result['monitor']=monitor(proc,out,deadline);result['phase']='closed';result['passed']=proc.returncode==0 and result['monitor']['resourceCheckPassed'] and result['monitor']['cleanup']['closed']
        if result['passed']:result['status']='ENVELOPE-DIAGNOSTIC-CLOSED-NO-CELL-ADMISSION'
    except BaseException as e:result['error']={'phase':result['phase'],'message':str(e)[:1000]}
    finally:
        if proc is not None and proc.poll() is None:
            try:result['finalCleanup']=close_child(proc)
            except BaseException as e:result['finalCleanup']={'closed':False,'error':str(e)};result['passed']=False
        if deadline.clock()-deadline.start>90:result['passed']=False;result['deadlineOverrun']=True
        result.update(elapsedSeconds=deadline.clock()-deadline.start,controllerReservationBytes=ledger.used,controllerLedger=ledger.entries,capacityClaim=False,nativeAccountingEstimatesNotProven=True,pythonRuntime='3.12.3-linux-x86_64')
        # Closed-process VmRSS is not zero-filled or promoted into capacity proof.
        # The child's own kernel maxRSS remains in stdout, separate from samples.
        if out.size()>114688:result['passed']=False;result['outputCapExceeded']=True
        report=json.dumps(result,separators=(',',':')).encode()
        if len(report)>16383:
            result['passed']=False;result['status']='STOP-REPORT-CAP'
            report=json.dumps({'status':result['status'],'passed':False,'resourceCapacityClaim':False,'childClosed':proc is None or proc.poll() is not None}).encode()
        try:out.write('.controller.json',report+b'\n',16384)
        finally:out.close();signal.setitimer(signal.ITIMER_REAL,0)
    print(json.dumps({'status':result['status'],'passed':result['passed'],'originalCellAdmission':False,'report':args.output_prefix+'.controller.json'}))
    return 0 if result['passed'] else 1
if __name__=='__main__':
    try:sys.exit(main())
    except (Stop,FileExistsError) as e:print(str(e),file=sys.stderr);sys.exit(1)
