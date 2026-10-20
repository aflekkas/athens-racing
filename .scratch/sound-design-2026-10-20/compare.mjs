import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const [prefix,name,caption]=process.argv.slice(2),dir='.scratch/sound-design-2026-10-20',feed='/home/dev/data/agent-feed/sound-design';
execFileSync('ffmpeg',['-v','error','-i',`${dir}/before-${name}.webp`,'-i',`${dir}/${prefix}-${name}.webp`,'-filter_complex',"[0:v]drawtext=text='BEFORE':fontsize=18:fontcolor=white:x=16:y=14[a];[1:v]drawtext=text='AFTER':fontsize=18:fontcolor=white:x=16:y=14[b];[a][b]vstack=inputs=2",'-frames:v','1','-c:v','libwebp','-quality','78','-y',`${feed}/${prefix}-${name}.webp`]);
writeFileSync(`${feed}/${prefix}-${name}.txt`,caption+'\n');
