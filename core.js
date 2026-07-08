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
  const res=await fetch(`https://api.jikan.moe/v4/anime?q=${q}&limit=8&sfw`);
  if(!res.ok) throw new Error('http '+res.status);
  const data=await res.json();
  const seen=new Set(), out=[];
  for(const it of (data.data||[])){
    const img=it.images&&it.images.jpg&&(it.images.jpg.large_image_url||it.images.jpg.image_url);
    if(!img||seen.has(img))continue; seen.add(img);
    let type='Show';
    const t=(it.type||'').toUpperCase();
    if(t==='MOVIE')type='Movie'; else if(t==='TV'||t==='ONA')type='Show'; else if(t)type='OVA';
    out.push({img, type, genres:(it.genres||[]).map(g=>g.name).slice(0,4), synopsis:it.synopsis||'', year:it.year||(it.aired&&it.aired.prop&&it.aired.prop.from&&it.aired.prop.from.year)||null, score:it.score||null});
  }
  return out;
}
function urlToDataURL(url){return new Promise((res,rej)=>{const img=new Image();img.crossOrigin='anonymous';img.onload=()=>{try{const maxW=460,scale=Math.min(1,maxW/img.naturalWidth),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);res(c.toDataURL('image/jpeg',0.85));}catch(e){rej(e);}};img.onerror=()=>rej(new Error('load'));img.src=url;});}
