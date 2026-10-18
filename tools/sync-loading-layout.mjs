// Regenerate the pre-module loading frame from the shared kit; no runtime flash.
import {readFileSync,writeFileSync} from 'node:fs';
import {mapStage} from '../src/ui/components.js';
import {loadingContent} from '../src/ui/loading-content.js';
const path='index.html', html=readFileSync(path,'utf8');
const generated='<!-- ui-layout:loading:start -->\n'+mapStage({variant:'loading',...loadingContent})+'\n<!-- ui-layout:loading:end -->';
const next=html.replace(/<!-- ui-layout:loading:start -->[\s\S]*?<!-- ui-layout:loading:end -->/,generated);
if(process.argv.includes('--check')) { if(next!==html)throw new Error('Run node tools/sync-loading-layout.mjs to refresh the kit loading template.'); }
else writeFileSync(path,next);
