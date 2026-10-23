import ast,types,json
from pathlib import Path
p=Path('/tmp/athens-terrain.uKVC/scipy-venv/lib/python3.12/site-packages/scipy/optimize/_highspy/_highs_wrapper.py')
t=ast.parse(p.read_text());fn=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='check_option')
class Manager:
 def check_string_option(self,k,v):return isinstance(v,str) and v in ('off','choose','on')
class Highs:
 def getOptionType(self,k):return (0,'string') if k=='run_crossover' else (1,None)
 def getOptionValue(self,k):return 0,'on'
ns={'hopt':types.SimpleNamespace(HighsOptionsManager=Manager),'_h':types.SimpleNamespace(HighsStatus=types.SimpleNamespace(kOk=0),HighsOptionType=types.SimpleNamespace(kBool='bool',kInt='int',kDouble='double',kString='string'))}
exec(compile(ast.Module(body=[fn],type_ignores=[]),str(p),'exec'),ns)
results=[]
for v in ['on','off','choose',False,True,'invalid',0]:
 status,msg=ns['check_option'](Highs(),'run_crossover',v);expected=isinstance(v,str) and v in ('on','off','choose');assert (status==0)==expected;results.append({'value':v,'acceptedByFakeControl':status==0})
assert ns['check_option'](Highs(),'misspelled_crossover','off')[0]!=0
print(json.dumps({'testsPassed':8,'realHiGHSImports':0,'realSolves':0,'scope':'Pinned check_option AST executed with fake option manager ONLY; not installed binary validation','results':results},indent=2))
