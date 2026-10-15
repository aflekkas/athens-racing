// Deliberate allowlist: never upload guest/session tokens, arbitrary localStorage or replay blobs.
export const progressKey = key => /^paraliaki\.(settings$|graphics$|raceSetup$|personalBests\.v1$|events\.|best\.|paint\.|car($|\.)|input\.|customization\.guest\.v1$|driving-feedback$)/.test(key);
export function guestProgress(storage) {
 const data={};try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(progressKey(key))data[key]=storage.getItem(key);}}catch{}return data;
}
export function cleanProgress(data) { return Object.fromEntries(Object.entries(data||{}).filter(([key,value])=>progressKey(key)&&typeof value==='string')); }
export function restoreProgress(storage, data) {try{for(const [key,value]of Object.entries(cleanProgress(data)))if(storage.getItem(key)===null)storage.setItem(key,value);}catch{}}
