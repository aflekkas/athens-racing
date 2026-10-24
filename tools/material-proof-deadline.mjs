// One original work deadline; cleanup never resets or extends admission.
export function createProofDeadline({report,limitMs,getPrimary,recordPrimary,checkExisting=()=>{},beforeClose=()=>{},closeBrowser,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}){
 const started=now(),expires=started+limitMs;let timer,cleanup=false,closeOutcome=null;
 const error=new Error('MATERIAL_WORK_DEADLINE_EXCEEDED');
 const observe=()=>{
  // Existing source/egress first causes have precedence over a later deadline.
  try{checkExisting();}catch(cause){recordPrimary(cause);}
  if(now()>=expires){report.deadlineExceeded=true;recordPrimary(error);}
  return getPrimary();
 };
 const check=()=>{const state=observe();if(state.hasPrimary)throw state.primaryError;};
 const fire=()=>{
  observe();
  if(report.deadlineExceeded&&!cleanup&&!closeOutcome){
   let hasPreparationError=false,preparationError;
   try{beforeClose();}catch(cause){hasPreparationError=true;preparationError=cause;}
   const settled=(ok,error)=>({ok,error,hasPreparationError,preparationError});
   try{closeOutcome=Promise.resolve(closeBrowser()).then(()=>settled(true),cause=>settled(false,cause));}
   catch(cause){closeOutcome=Promise.resolve(settled(false,cause));}
  }
 };
 timer=schedule(fire,limitMs);timer?.unref?.();
 const execute=async action=>{check();const value=await action();check();return value;};
 const guardPage=page=>new Proxy(page,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(['goto','evaluate','waitForFunction','addInitScript','route','routeWebSocket'].includes(key))return (...args)=>execute(()=>value.apply(target,args));return value.bind(target);}});
 return {check,observe,execute,guardPage,beginCleanup(){cleanup=true;cancel(timer);},timerClose:()=>closeOutcome,started,expires};
}
