/* Reel — Offline Library. Plain classic scripts, load order: core.js, player.js, index.js. Globals are shared across files. */

/* ============ IndexedDB (video blobs) ============ */
const DB_NAME='reel_offline_library', STORE='videos';
let _db=null;
function db(){
  if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});
    r.onsuccess=()=>{_db=r.result;res(_db);};
    r.onerror=()=>rej(r.error);
  });
}
async function idbPut(id,blob){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).put({id,blob});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}
async function idbGet(id){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,'readonly').objectStore(STORE).get(id);r.onsuccess=()=>res(r.result?r.result.blob:null);r.onerror=()=>rej(r.error);});}
async function idbDel(id){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});}

/* ============ localStorage (library index) ============ */
const LS_KEY='reel_library_v2';
function loadLibrary(){try{return JSON.parse(localStorage.getItem(LS_KEY))||[];}catch{return[];}}
function saveLibrary(){try{localStorage.setItem(LS_KEY,JSON.stringify(library));}catch(e){toast('Could not save. Storage may be full.',true);}}
let library=loadLibrary();
migrate();

/* ============ helpers ============ */
const $=s=>document.querySelector(s);
const stage=$('#stage');
function uid(){return 'v_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function cleanTitle(fn){
  let n=fn.replace(/\.[^.]+$/,'');
  n=n.replace(/[._]+/g,' ');
  n=n.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g,' ');
  n=n.replace(/\b(1080p|720p|480p|2160p|4k|x264|x265|hevc|h ?264|h ?265|bluray|web[- ]?dl|webrip|hdrip|aac|dts|10bit|dual[- ]?audio)\b/gi,' ');
  n=n.replace(/\bs\d{1,2}\s?e\d{1,3}\b/gi,' ');
  n=n.replace(/\bseason\s?\d+|\bepisode\s?\d+|\bep\s?\d+\b/gi,' ');
  n=n.replace(/\s+-\s+\d+\s*$/,' ');
  n=n.replace(/\s{2,}/g,' ').trim();
  return n.replace(/\b\w/g,c=>c.toUpperCase());
}
function fmtSize(b){if(!b)return'';const u=['B','KB','MB','GB'];let i=0;while(b>=1024&&i<u.length-1){b/=1024;i++;}return b.toFixed(b<10&&i>0?1:0)+' '+u[i];}
function fmtDur(s){s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?h+'h '+m+'m':(m||1)+'m';}
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function escapeAttr(s){return(s||'').replace(/"/g,'&quot;');}
let toastTimer;
function toast(msg,err){const t=$('#toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',3200);}
function typeClass(t){return t==='Movie'?'movie':(t==='OVA'?'emerald':'');}

/* ============ frame capture ============ */
function seek(v,t){return new Promise((res,rej)=>{const done=()=>{v.removeEventListener('seeked',done);res();};v.addEventListener('seeked',done,{once:true});v.addEventListener('error',()=>rej(new Error('seek')),{once:true});try{v.currentTime=t;}catch(e){rej(e);}});}
function grabFrame(v,maxW){const scale=Math.min(1,maxW/(v.videoWidth||maxW));const c=document.createElement('canvas');c.width=Math.max(2,Math.round((v.videoWidth||maxW)*scale));c.height=Math.max(2,Math.round((v.videoHeight||maxW)*scale));c.getContext('2d').drawImage(v,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.72);}
async function captureFrames(file,count){
  const url=URL.createObjectURL(file);
  const v=document.createElement('video');
  v.muted=true;v.playsInline=true;v.preload='auto';v.src=url;
  stage.appendChild(v);
  const out={frames:[],duration:0};
  try{
    await new Promise((res,rej)=>{v.addEventListener('loadedmetadata',res,{once:true});v.addEventListener('error',()=>rej(new Error('meta')),{once:true});setTimeout(()=>rej(new Error('timeout')),15000);});
    let dur=v.duration; if(!isFinite(dur)||dur<=0)dur=0; out.duration=dur;
    if(dur>0){for(let i=1;i<=count;i++){const t=dur*(i/(count+1));try{await seek(v,t);out.frames.push(grabFrame(v,420));}catch(e){}}}
  }catch(e){}finally{URL.revokeObjectURL(url);v.remove();}
  return out;
}

/* ============ online lookup (Jikan / MyAnimeList) ============ */
async function searchOnline(title){
  const q=encodeURIComponent((title||'').trim());
  if(!q) return [];
  const url=`https://api.jikan.moe/v4/anime?q=${q}&limit=8&sfw=true`;
  let data=null;
  for(let attempt=0; attempt<3; attempt++){
    try{
      const res=await fetch(url,{headers:{'Accept':'application/json'}});
      if(res.status===429){ await new Promise(r=>setTimeout(r,1300)); continue; }
      if(!res.ok) throw new Error('http '+res.status);
      data=await res.json(); break;
    }catch(e){ if(attempt===2) throw e; await new Promise(r=>setTimeout(r,700)); }
  }
  const seen=new Set(), out=[];
  for(const it of ((data&&data.data)||[])){
    const img=it.images&&it.images.jpg&&(it.images.jpg.large_image_url||it.images.jpg.image_url);
    if(!img||seen.has(img))continue; seen.add(img);
    let type='Show';
    const t=(it.type||'').toUpperCase();
    if(t==='MOVIE')type='Movie'; else if(t==='TV'||t==='ONA')type='Show'; else if(t)type='OVA';
    out.push({img, type, genres:(it.genres||[]).map(g=>g.name).slice(0,4), synopsis:it.synopsis||'', year:it.year||(it.aired&&it.aired.prop&&it.aired.prop.from&&it.aired.prop.from.year)||null, score:it.score||null});
  }
  return out;
}
function proxify(u){ if(!u) return u; return 'https://images.weserv.nl/?url=ssl:'+u.replace(/^https?:\/\//,'')+'&w=460&output=jpg'; }
async function coverToDataURL(url){
  try{ return await urlToDataURL(url); }catch(e){}
  try{ return await urlToDataURL(proxify(url)); }catch(e){}
  return null;
}
function urlToDataURL(url){return new Promise((res,rej)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const maxW=460,scale=Math.min(1,maxW/img.naturalWidth),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',0.85));}catch(e){rej(e);}};img.onerror=()=>rej(new Error('load'));img.src=url;});}

/* ============ series / shows ============ */
function parseEpisode(raw){
  let n=raw.replace(/\.[^.]+$/,'').replace(/[._]+/g,' ');
  let m;
  if(m=n.match(/\bs(\d{1,2})\s*[\- ]?\s*e(\d{1,3})\b/i)) return {season:+m[1],episode:+m[2]};
  if(m=n.match(/\bseason\s*(\d{1,2})\b[^\d]*?\b(?:episode|ep)\s*(\d{1,3})\b/i)) return {season:+m[1],episode:+m[2]};
  if(m=n.match(/\b(?:episode|ep)\s*(\d{1,3})\b/i)) return {season:1,episode:+m[1]};
  if(m=n.match(/\s[-–—]\s*(\d{1,3})\s*$/)) return {season:1,episode:+m[1]};
  return {season:1,episode:null};
}
function normShow(s){return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function parseLang(raw){
  const n=(raw||'').replace(/[._]+/g,' ');
  if(/\b(dual[\s-]?audio|multi[\s-]?audio)\b/i.test(n)) return 'Both';
  if(/\b(dub|dubbed|eng(?:lish)?[\s-]?dub)\b/i.test(n)) return 'Dub';
  if(/\b(sub|subbed|subtitled)\b/i.test(n)) return 'Sub';
  return null;
}
function isCompleted(v){const d=v.duration||0;if(d<=0)return false;return (v.progress||0)>=d-600||(v.progress||0)>=d*0.9;}

function groupShows(items){
  const map=new Map();
  items.forEach(v=>{
    const key=normShow(v.show||v.title);
    if(!map.has(key)) map.set(key,{key,name:v.show||v.title,episodes:[]});
    map.get(key).episodes.push(v);
  });
  const shows=[...map.values()];
  shows.forEach(s=>{
    s.episodes.sort((a,b)=>
      ((a.season||1)-(b.season||1)) ||
      (((a.episode==null?1e9:a.episode))-((b.episode==null?1e9:b.episode))) ||
      ((a.addedAt||0)-(b.addedAt||0)));
    const cov=s.episodes.find(e=>e.cover)||s.episodes[0];
    s.cover=cov.cover; s.coverType=cov.coverType;
    const stl=s.episodes.find(e=>e.still)||s.episodes[0];
    s.still=stl.still;
    const gen=s.episodes.find(e=>e.genres&&e.genres.length);
    s.genres=gen?gen.genres:[];
    const syn=s.episodes.find(e=>e.synopsis);
    s.synopsis=syn?syn.synopsis:'';
    s.type=(s.episodes.find(e=>e.type)||{}).type||'Show';
    s.year=(s.episodes.find(e=>e.year)||{}).year||null;
    s.score=(s.episodes.find(e=>e.score)||{}).score||null;
    s.size=s.episodes.reduce((x,e)=>x+(e.size||0),0);
    s.addedAt=Math.max.apply(null,s.episodes.map(e=>e.addedAt||0));
    s.count=s.episodes.length;
    s.multiSeason=new Set(s.episodes.map(e=>e.season||1)).size>1;
    const langs=new Set(s.episodes.map(e=>e.lang||'Both'));
    s.lang = (langs.has('Both')||(langs.has('Sub')&&langs.has('Dub'))) ? 'Both' : ([...langs][0]||'Both');
    const inProg=s.episodes.filter(e=>(e.progress||0)>20 && !isCompleted(e));
    inProg.sort((a,b)=>(b.lastWatched||0)-(a.lastWatched||0));
    s.resume=inProg[0]||null;
  });
  return shows;
}
function existingShowMeta(name){
  const key=normShow(name);
  if(!library.some(v=>normShow(v.show||v.title)===key)) return null;
  return groupShows(library).find(s=>s.key===key)||null;
}
function migrate(){
  let changed=false;
  (library||[]).forEach(v=>{
    if(v.show===undefined){v.show=v.title; changed=true;}
    if(v.season===undefined){v.season=1; changed=true;}
    if(v.episode===undefined){v.episode=null; changed=true;}
    if(v.lastWatched===undefined){v.lastWatched=0; changed=true;}
    if(v.lang===undefined){v.lang='Both'; changed=true;}
  });
  if(changed) saveLibrary();
}

/* ============ export / import library ============ */
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),8000);
}
// Container: "KURA" + 12-digit header length + header JSON + concatenated video blobs.
async function exportLibrary(onProgress){
  const validItems=[], parts=[], blobsMeta=[];
  for(let i=0;i<library.length;i++){
    const it=library[i];
    let blob=null; try{ blob=await idbGet(it.id); }catch(e){}
    if(!blob) continue;
    validItems.push(it); parts.push(blob); blobsMeta.push({id:it.id,size:blob.size});
    if(onProgress) onProgress(i+1, library.length, 'Packing');
  }
  if(!validItems.length) throw new Error('No saved videos to export');
  const header=JSON.stringify({v:1, exportedAt:Date.now(), library:validItems, blobs:blobsMeta});
  const headerBytes=new TextEncoder().encode(header);
  const prefix='KURA'+String(headerBytes.length).padStart(12,'0');
  return new Blob([prefix, headerBytes, ...parts], {type:'application/octet-stream'});
}
function isDupRecord(rec){
  return library.some(v=>
    (v.size||0)===(rec.size||0) &&
    (v.episode==null?null:v.episode)===(rec.episode==null?null:rec.episode) &&
    (v.season||1)===(rec.season||1) &&
    normShow(v.show||v.title)===normShow(rec.show||rec.title));
}
async function importLibrary(file,onProgress){
  const head=await file.slice(0,16).text();
  if(!head.startsWith('KURA')) throw new Error('Not a Kura library file');
  const hlen=parseInt(head.slice(4,16),10);
  if(!hlen||isNaN(hlen)) throw new Error('Corrupt file header');
  const meta=JSON.parse(await file.slice(16,16+hlen).text());
  const items=meta.library||[], blobs=meta.blobs||[];
  const byId={}; items.forEach(it=>byId[it.id]=it);
  let offset=16+hlen, added=0;
  for(let i=0;i<blobs.length;i++){
    const b=blobs[i], src=byId[b.id];
    const start=offset; offset+=b.size;
    if(!src || isDupRecord(src)) { if(onProgress)onProgress(i+1,blobs.length,'Importing'); continue; }
    const blob=file.slice(start, offset);
    const newId=uid();
    try{ await idbPut(newId, blob); }catch(e){ continue; }
    library.unshift(Object.assign({}, src, {id:newId}));
    added++;
    if(onProgress) onProgress(i+1, blobs.length, 'Importing');
  }
  migrate(); saveLibrary();
  return added;
}
