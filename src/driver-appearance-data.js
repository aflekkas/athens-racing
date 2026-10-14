// DOM/Three-free appearance contract shared by Driver and multiplayer validation.
export const DEFAULT_DRIVER_APPEARANCE=Object.freeze({skin:'#b67c56',shirt:'#16181c',hair:'#30231c',hairStyle:'curly',helmet:false});
export function normalizeDriverAppearance(value){
  const d=value&&typeof value==='object'?value:{};
  const result={...DEFAULT_DRIVER_APPEARANCE};
  for(const key of ['skin','shirt','hair'])if(typeof d[key]==='string'&&/^#[a-f\d]{6}$/i.test(d[key]))result[key]=d[key].toLowerCase();
  if(['short','curly','none'].includes(d.hairStyle))result.hairStyle=d.hairStyle;
  result.helmet=d.helmet===true;
  return result;
}
