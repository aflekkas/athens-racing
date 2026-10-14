import test from 'node:test';
import assert from 'node:assert/strict';
import { syncLobbySetup } from '../src/ui/lobby-setup.js';

// Small DOM surface models a room whose optional sections have been removed by a race transition.
class Element {
  constructor(tag='div'){this.tag=tag;this.dataset={};this.children=[];this.hidden=false;this.html='';}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  prepend(node){node.parent=this;this.children.unshift(node);}
  before(node){const list=this.parent.children;node.parent=this.parent;list.splice(list.indexOf(this),0,node);}
  remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);}
  querySelector(selector){if(selector==='[data-lobby-setup]')return this.children.find(n=>'lobbySetup'in n.dataset)||null;return null;}
  querySelectorAll(){return [];}
  contains(node){return this.children.includes(node);}
  set innerHTML(value){this.html=value;this.writes=(this.writes||0)+1;}
  get innerHTML(){return this.html;}
}
for(const host of [true,false])test(`lobby sync tolerates missing car toggles/browser for ${host?'host':'guest'}`,()=>{
  const room=new Element(),panel=new Element();
  const oldWindow=globalThis.window,oldDocument=globalThis.document,oldObserver=globalThis.MutationObserver,oldWarn=console.warn;let warnings=0;
  globalThis.MutationObserver=class {observe(){}};console.warn=()=>warnings++;
  globalThis.window={__multiplayer:{id:'me',panel,lobby:{host:host?'me':'other',status:'waiting',mode:'sprint'},setLobbyConfig(){}}};
  globalThis.document={activeElement:null,getElementById:id=>id==='mp-room'?room:null,createElement:tag=>new Element(tag)};
  try{
    assert.doesNotThrow(()=>syncLobbySetup());
    const section=room.querySelector('[data-lobby-setup]');assert.ok(section,'setup appends directly to a room with no anchor');
    const writes=section.writes;syncLobbySetup();syncLobbySetup();assert.equal(section.writes,writes,'observer repeats do not mutate a stable room');
    assert.equal(warnings,0,'partial DOM does not need the exception fallback');
    window.__multiplayer.panel=null;assert.doesNotThrow(()=>syncLobbySetup(),'torn-down panel is safe');
  }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.MutationObserver=oldObserver;console.warn=oldWarn;}
});
test('a failing lobby getter cannot throw through the observer or recursively re-enter',()=>{
  const oldWindow=globalThis.window,oldDocument=globalThis.document,oldWarn=console.warn;let reports=0,calls=0;
  globalThis.document={activeElement:null,getElementById:()=>new Element(),createElement:tag=>new Element(tag)};
  globalThis.window={__multiplayer:{id:'me',panel:new Element(),lobby:{host:'me'},getLobbyConfig(){calls++;syncLobbySetup();throw new Error('panel replaced');}}};console.warn=()=>reports++;
  try{assert.doesNotThrow(()=>syncLobbySetup());syncLobbySetup();assert.equal(calls,2);assert.equal(reports,1);}
  finally{globalThis.window=oldWindow;globalThis.document=oldDocument;console.warn=oldWarn;}
});
