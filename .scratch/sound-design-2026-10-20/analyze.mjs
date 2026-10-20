import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const [prefix='before',raw='/tmp/sound-design.u1Gf/raw',filter='']=process.argv.slice(2),out=resolve('.scratch/sound-design-2026-10-20');mkdirSync(out,{recursive:true});
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
 for(let len=2;len<=n;len*=2){const wr=Math.cos(-2*Math.PI/len),wi=Math.sin(-2*Math.PI/len);for(let i=0;i<n;i+=len){let ar=1,ai=0;for(let j=0;j<len/2;j++){const k=i+j,l=k+len/2,tr=ar*re[l]-ai*im[l],ti=ar*im[l]+ai*re[l];re[l]=re[k]-tr;im[l]=im[k]-ti;re[k]+=tr;im[k]+=ti;const t=ar;ar=t*wr-ai*wi;ai=t*wi+ai*wr;}}}}
const rows=[];
for(const file of readdirSync(raw).filter(f=>f.startsWith(prefix+'-')&&f.endsWith('.f32')&&(!filter||new RegExp(filter).test(f)))){
 const bytes=readFileSync(resolve(raw,file)),x=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),frames=x.length/2,sr=44100,name=file.slice(prefix.length+1,-4),base=resolve(out,prefix+'-'+name);let peak=0,sum=0,maxStep=0,onset=null;
 for(let i=0;i<x.length;i++){peak=Math.max(peak,Math.abs(x[i]));sum+=x[i]*x[i];if(i>=2)maxStep=Math.max(maxStep,Math.abs(x[i]-x[i-2]));if(onset===null&&Math.abs(x[i])>.001)onset=Math.floor(i/2)/sr;}
 let total=0,weighted=0,high=0,low=0;const size=2048;
 for(let at=0;at+size<frames;at+=11025){const re=new Float64Array(size),im=new Float64Array(size);for(let i=0;i<size;i++)re[i]=(x[(at+i)*2]+x[(at+i)*2+1])*.5*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));fft(re,im);for(let i=1;i<size/2;i++){const e=re[i]**2+im[i]**2,hz=i*sr/size;total+=e;weighted+=e*hz;if(hz>6000)high+=e;if(hz<250)low+=e;}}
 const input=['-f','f32le','-ar','44100','-ac','2','-i',resolve(raw,file)];
 // ffmpeg writes measurement reports on stderr; obtain separately with spawnSync below.
 const {spawnSync}=await import('node:child_process');const log=spawnSync('ffmpeg',['-hide_banner',...input,'-af','ebur128=peak=true','-f','null','-'],{encoding:'utf8'}).stderr;
 const lufs=[...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1],tp=[...log.matchAll(/Peak:\s+(-?[\d.]+) dBFS/g)].at(-1)?.[1];
 execFileSync('ffmpeg',['-v','error',...input,'-c:a','libvorbis','-q:a','3','-y',base+'.ogg']);
 execFileSync('ffmpeg',['-v','error',...input,'-filter_complex','[0:a]asplit=2[s][w];[s]showspectrumpic=s=960x300:legend=1:scale=log:color=intensity[sp];[w]showwavespic=s=1008x120:split_channels=0:colors=77c6ee[wa];[sp]scale=1008:360[ss];[ss][wa]vstack=inputs=2','-frames:v','1','-c:v','libwebp','-quality','72','-y',base+'.webp']);
 const r={name,seconds:frames/sr,lufs:Number(lufs),peakDb:peak?20*Math.log10(peak):-120,truePeakDb:Number(tp),rmsDb:sum?10*Math.log10(sum/x.length):-120,centroidHz:total?weighted/total:0,above6kPercent:total?high/total*100:0,below250Percent:total?low/total*100:0,onsetSec:onset,maxStep};rows.push(r);console.log(JSON.stringify(r));
 writeFileSync(base+'.txt',`${prefix}: ${name} — ${r.lufs} LUFS, ${r.peakDb.toFixed(1)} dBFS peak; spectrogram and waveform at default mix, no normalization.\n`);
}
writeFileSync(resolve(out,prefix+'-metrics'+(filter?'-selected':'')+'.json'),JSON.stringify(rows,null,2));
