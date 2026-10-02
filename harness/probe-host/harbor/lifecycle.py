from common import operation_args, base_dir, unit_name, preflight_unit, cli_root, cli_version
spec,args=operation_args('lifecycle')
REVIEWS=args.rows
from pathlib import Path
import subprocess,json
base=base_dir(spec)
for idx in REVIEWS:
 r=base/f'cell-{idx:03}';u=unit_name(spec,r.name)
 d=dict(l.split('=',1) for l in subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','Result','-p','ExecMainStatus','-p','ControlGroup']).decode().splitlines())
 cg=Path('/sys/fs/cgroup'+d['ControlGroup']) if d['ControlGroup'] else None
 d['remainingPids']=[p.read_text() for p in cg.rglob('cgroup.procs')] if cg and cg.exists() else []
 assert d['ActiveState']=='failed' and d['ExecMainStatus']=='0' and d['Result']=='timeout' and not any(s.strip() for s in d['remainingPids']),d
 assert json.loads((r/'stream.jsonl').read_text().splitlines()[-1])['type']=='turn.completed'
 d['classification']='turn completed; main exit zero; residual child cleanup timeout'
 d['journal']=subprocess.check_output(['journalctl','-u',u,'-n','12','--no-pager']).decode()
 assert "stop-sigterm" in d['journal']
 (r/'lifecycle-review.json').write_text(json.dumps(d,indent=2)+'\n')
 print(r.name,d['classification'])
