/* Reel — Offline Library. Plain classic scripts, load order: core.js, player.js, index.js. Globals are shared across files. */

/* ============ add flow / modal ============ */
let queue=[], current=null, selectedCover=null, selectedMeta=null;
const overlay=$('#overlay');
$('#fileInput').addEventListener('change',e=>{
  const files=[...e.target.files].filter(f=>f.type.startsWith('video/')||/\.(mp4|webm|ogv|mov|mkv|m4v)$/i.test(f.name));
  e.target.value='';
  if(!files.length){toast('No video files selected.',true);return;}
  queue=files; nextInQueue();
});
async function nextInQueue(){
  if(!queue.length){closeModal();return;}
  const file=queue.shift();
  current={id:uid(),file,title:cleanTitle(file.name),duration:0,still:null};
  selectedCover=null; selectedMeta=null;
  await openModalFor(current,queue.length);
}
async function openModalFor(item,remaining){
  $('#mName').value=item.title;
  $('#mType').value='Show';
  $('#mQueue').textContent=remaining>0?(remaining+' more queued'):'';
  $('#mSearchState').innerHTML='';
  const covers=$('#mCovers'); covers.innerHTML=''; addUploadTile(covers);
  overlay.classList.add('open'); $('#mName').focus();
  const {frames,duration}=await captureFrames(item.file,6);
  item.duration=duration;
  if(frames.length){
    item.still=frames[Math.floor(frames.length/2)]||frames[0];
    frames.forEach((f,i)=>{
      const tile=coverTile(f,'data',f,null);
      covers.insertBefore(tile,covers.querySelector('.upload'));
      if(i===0) selectCover(tile,{kind:'data',value:f},null);
    });
  }else{
    const n=document.createElement('p'); n.className='hint';
    n.textContent='Could not read frames from this file (the browser may not decode this format). Try Find covers or upload your own.';
    $('#mSearchState').appendChild(n);
  }
  runOnlineSearch(item.title,true);
}
function addUploadTile(c){
  const t=document.createElement('div'); t.className='cover-opt upload';
  t.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 .7.3l4 4-1.4 1.4L13 6.4V15h-2V6.4L8.7 8.7 7.3 7.3l4-4A1 1 0 0 1 12 3ZM5 17h14v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2Z"/></svg><span>Upload image</span>';
  t.addEventListener('click',()=>$('#coverUpload').click());
  c.appendChild(t);
}
$('#coverUpload').addEventListener('change',e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f)return;
  const r=new FileReader();
  r.onload=()=>{const covers=$('#mCovers');const tile=coverTile(r.result,'data',r.result,null);covers.insertBefore(tile,covers.querySelector('.upload'));selectCover(tile,{kind:'data',value:r.result},null);};
  r.readAsDataURL(f);
});
function coverTile(src,kind,value,meta){
  const t=document.createElement('div'); t.className='cover-opt';
  t.innerHTML='<img alt="Cover option" src="'+src+'"><span class="check"><svg viewBox="0 0 24 24"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7 9.5 16.2Z"/></svg></span>';
  t.addEventListener('click',()=>selectCover(t,{kind,value},meta));
  return t;
}
function selectCover(tile,cover,meta){
  document.querySelectorAll('.cover-opt.sel').forEach(el=>el.classList.remove('sel'));
  tile.classList.add('sel'); selectedCover=cover; selectedMeta=meta;
  if(meta&&meta.type) $('#mType').value=meta.type;
}
let searchDebounce;
$('#mName').addEventListener('input',e=>{if(current)current.title=e.target.value;});
$('#mFind').addEventListener('click',()=>runOnlineSearch($('#mName').value,false));
async function runOnlineSearch(title,quiet){
  if(!title||!title.trim()){if(!quiet)toast('Type a title first.',true);return;}
  const state=$('#mSearchState');
  state.innerHTML='<div class="searching"><span class="spinner"></span> Looking for “'+escapeHtml(title.trim())+'” covers…</div>';
  try{
    const results=await searchOnline(title);
    state.innerHTML='';
    if(!results.length){state.innerHTML='<p class="hint">No online covers found for that title. Frames and uploads still work.</p>';return;}
    const covers=$('#mCovers');
    results.forEach(r=>{const tile=coverTile(r.img,'url',r.img,r);covers.appendChild(tile);});
  }catch(e){
    state.innerHTML='<p class="hint">Could not reach the cover database (you may be offline, or it is rate-limited). Frames and uploads still work.</p>';
  }
}
$('#mSave').addEventListener('click',saveCurrent);
async function saveCurrent(){
  if(!current)return;
  const title=($('#mName').value||'Untitled').trim();
  let coverType='none',cover='';
  if(selectedCover){
    if(selectedCover.kind==='data'){coverType='data';cover=selectedCover.value;}
    else{try{cover=await urlToDataURL(selectedCover.value);coverType='data';}catch(e){cover=selectedCover.value;coverType='url';}}
  }
  $('#mSave').disabled=true;
  try{await idbPut(current.id,current.file);}
  catch(e){$('#mSave').disabled=false;toast('Could not save the video file. It may be too large for this device.',true);return;}
  const m=selectedMeta||{};
  library.unshift({
    id:current.id, title, type:$('#mType').value||'Show',
    coverType, cover, still:current.still||null,
    genres:m.genres||[], synopsis:m.synopsis||'', year:m.year||null, score:m.score||null,
    duration:current.duration||0, size:current.file.size, mime:current.file.type,
    addedAt:Date.now(), progress:0
  });
  saveLibrary(); rebuild();
  $('#mSave').disabled=false; toast('Added “'+title+'”');
  current=null; nextInQueue();
}
$('#mSkip').addEventListener('click',()=>{current=null;nextInQueue();});
$('#mClose').addEventListener('click',()=>{queue=[];current=null;closeModal();});
overlay.addEventListener('click',e=>{if(e.target===overlay){queue=[];current=null;closeModal();}});
function closeModal(){overlay.classList.remove('open');}

/* ============ view state ============ */
let filterType='All', filterGenre=null, view='home'; // home | grid | stats
let heroItems=[], heroIndex=0, heroTimer=null;

function rebuild(){
  const has=library.length>0;
  $('#empty').style.display = (has || view==='stats') ? 'none' : 'block';
  $('#hero').style.display = (has && view!=='stats') ? 'block' : 'none';
  $('#filters').style.display = (has && view!=='stats') ? 'block' : 'none';
  $('#statsView').style.display = view==='stats' ? 'block' : 'none';

  if(view==='stats'){ $('#rows').innerHTML=''; $('#gridView').style.display='none'; renderStats(); return; }
  if(!has){ $('#rows').innerHTML=''; $('#gridView').style.display='none'; $('#hero').innerHTML=''; return; }

  renderHero();
  renderFilters();
  if(view==='grid'){ $('#rows').innerHTML=''; $('#gridView').style.display='block'; renderGrid(); }
  else { $('#gridView').style.display='none'; renderRows(); }
}

/* ---- hero ---- */
function renderHero(){
  const term=($('#filter').value||'').toLowerCase();
  const pool=library.filter(v=>matchesType(v)&&(!term||v.title.toLowerCase().includes(term)));
  heroItems=pool.filter(v=>v.cover||v.still).slice(0,6);
  if(!heroItems.length) heroItems=pool.slice(0,6);
  if(!heroItems.length){$('#hero').style.display='none';return;}
  if(heroIndex>=heroItems.length) heroIndex=0;
  drawHero();
  clearInterval(heroTimer);
  if(heroItems.length>1) heroTimer=setInterval(()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();},7000);
}
function drawHero(){
  const v=heroItems[heroIndex]; if(!v)return;
  const bg=v.cover||v.still||'';
  const posterInner=(v.cover)?'<img alt="" src="'+v.cover+'">':(v.still?'<img alt="" src="'+v.still+'">':'<div class="ph">'+(v.title[0]||'?').toUpperCase()+'</div>');
  const desc=v.synopsis?escapeHtml(v.synopsis):('Saved on this device · '+fmtSize(v.size)+(v.duration?' · '+fmtDur(v.duration):''));
  const tags=[];
  if(v.type)tags.push(v.type);
  if(v.year)tags.push(v.year);
  if(v.score)tags.push('★ '+v.score);
  (v.genres||[]).slice(0,3).forEach(g=>tags.push(g));
  const dots=heroItems.map((_,i)=>'<i class="'+(i===heroIndex?'on':'')+'" data-i="'+i+'"></i>').join('');
  $('#hero').innerHTML=
    (bg?'<div class="hero-bg" style="background-image:url('+"'"+bg+"'"+')"></div>':'<div class="hero-bg" style="background:linear-gradient(135deg,#141824,#1a1f2e)"></div>')+
    '<div class="hero-nav">'+
      (heroItems.length>1?'<button class="arrow" id="hPrev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6 1.4-1.4L11.8 12l4.6-4.6L15 6Z"/></svg></button><div class="dots">'+dots+'</div><button class="arrow" id="hNext" aria-label="Next"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6-1.4-1.4L12.2 12 7.6 7.4 9 6Z"/></svg></button>':'')+
    '</div>'+
    '<div class="hero-inner">'+
      '<div class="hero-poster">'+posterInner+'</div>'+
      '<div class="hero-text">'+
        '<div class="hero-eyebrow">'+escapeHtml(v.type||'Video')+'</div>'+
        '<div class="hero-title">'+escapeHtml(v.title)+'</div>'+
        '<div class="hero-desc">'+desc+'</div>'+
        (tags.length?'<div class="hero-tags">'+tags.map(t=>'<span>'+escapeHtml(String(t))+'</span>').join('')+'</div>':'')+
        '<div class="hero-actions">'+
          '<button class="btn primary" id="hPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg> Watch now</button>'+
          '<button class="btn danger ghost" id="hDelete"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1L7 9Z"/></svg> Delete</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  const play=$('#hPlay'); if(play)play.onclick=()=>openPlayer(v.id);
  const del=$('#hDelete'); if(del)del.onclick=()=>deleteItem(v.id,v.title);
  const prev=$('#hPrev'); if(prev)prev.onclick=()=>{heroIndex=(heroIndex-1+heroItems.length)%heroItems.length;drawHero();resetHeroTimer();};
  const next=$('#hNext'); if(next)next.onclick=()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();resetHeroTimer();};
  document.querySelectorAll('#hero .dots i').forEach(d=>d.onclick=()=>{heroIndex=+d.dataset.i;drawHero();resetHeroTimer();});
}
function resetHeroTimer(){clearInterval(heroTimer);if(heroItems.length>1)heroTimer=setInterval(()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();},7000);}

/* ---- filters ---- */
function matchesType(v){return filterType==='All'||v.type===filterType;}
function renderFilters(){
  const types=['All','Show','Movie','OVA'];
  const labelMap={All:'All',Show:'Shows',Movie:'Movies',OVA:'OVA'};
  $('#typeTabs').innerHTML=types.map(t=>'<button class="'+(filterType===t?'on':'')+'" data-t="'+t+'">'+labelMap[t]+'</button>').join('');
  document.querySelectorAll('#typeTabs button').forEach(b=>b.onclick=()=>{filterType=b.dataset.t;heroIndex=0;rebuild();});

  const gcount={};
  library.filter(matchesType).forEach(v=>(v.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
  const genres=Object.keys(gcount).sort((a,b)=>gcount[b]-gcount[a]);
  let chips='<button class="'+(!filterGenre?'on':'')+'" data-g="__all">All</button>';
  chips+=genres.map(g=>'<button class="'+(filterGenre===g?'on':'')+'" data-g="'+escapeAttr(g)+'">'+escapeHtml(g)+'</button>').join('');
  $('#genreChips').innerHTML=chips;
  document.querySelectorAll('#genreChips button').forEach(b=>b.onclick=()=>{
    const g=b.dataset.g;
    if(g==='__all'){filterGenre=null;view='home';}
    else{filterGenre=g;view='grid';}
    rebuild();
  });
}

/* ---- rows (home) ---- */
function renderRows(){
  const term=($('#filter').value||'').toLowerCase();
  const base=library.filter(v=>matchesType(v)&&(!term||v.title.toLowerCase().includes(term)));
  const rows=$('#rows'); rows.innerHTML='';

  const continuing=base.filter(v=>v.progress>20 && (!v.duration || v.progress < v.duration-20))
    .sort((a,b)=>b.addedAt-a.addedAt);
  if(continuing.length) rows.appendChild(buildRow('Continue watching',continuing,true,null));

  const recent=[...base].sort((a,b)=>b.addedAt-a.addedAt);
  if(recent.length) rows.appendChild(buildRow('Recently added',recent,false,'__recent'));

  const gcount={};
  base.forEach(v=>(v.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
  Object.keys(gcount).sort((a,b)=>gcount[b]-gcount[a]).slice(0,8).forEach(g=>{
    const items=base.filter(v=>(v.genres||[]).includes(g)).sort((a,b)=>b.addedAt-a.addedAt);
    if(items.length) rows.appendChild(buildRow(g,items,false,g));
  });

  if(!continuing.length && !recent.length){
    rows.innerHTML='<p class="hint" style="padding:0 34px">No titles match your filters.</p>';
  }
}
function buildRow(title,items,landscape,viewAllKey){
  const sec=document.createElement('div'); sec.className='row';
  const head=document.createElement('div'); head.className='row-head';
  head.innerHTML='<h2>'+escapeHtml(title)+'</h2>';
  if(viewAllKey){
    const va=document.createElement('button'); va.className='view-all'; va.textContent='View all';
    va.onclick=()=>{ if(viewAllKey==='__recent'){filterGenre=null;} else {filterGenre=viewAllKey;} view='grid'; rebuild(); };
    head.appendChild(va);
  }
  sec.appendChild(head);
  const wrap=document.createElement('div'); wrap.className='scroller-wrap';
  const sc=document.createElement('div'); sc.className='scroller';
  items.forEach(v=>sc.appendChild(makeCard(v,landscape)));
  const left=document.createElement('button'); left.className='row-arrow left'; left.disabled=true;
  left.innerHTML='<svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6 1.4-1.4L11.8 12l4.6-4.6L15 6Z"/></svg>';
  const right=document.createElement('button'); right.className='row-arrow right';
  right.innerHTML='<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6-1.4-1.4L12.2 12 7.6 7.4 9 6Z"/></svg>';
  const upd=()=>{left.disabled=sc.scrollLeft<8;right.disabled=sc.scrollLeft+sc.clientWidth>=sc.scrollWidth-8;};
  left.onclick=()=>{sc.scrollBy({left:-sc.clientWidth*0.8,behavior:'smooth'});};
  right.onclick=()=>{sc.scrollBy({left:sc.clientWidth*0.8,behavior:'smooth'});};
  sc.addEventListener('scroll',upd);
  wrap.appendChild(left); wrap.appendChild(sc); wrap.appendChild(right);
  sec.appendChild(wrap);
  setTimeout(upd,50);
  return sec;
}
function makeCard(v,landscape){
  const card=document.createElement('div');
  card.className='card '+(landscape?'land':'portrait');
  const img=landscape?(v.still||v.cover):(v.cover||v.still);
  const inner=img?'<img alt="'+escapeAttr(v.title)+'" loading="lazy" src="'+img+'">':'<div class="ph">'+(v.title[0]||'?').toUpperCase()+'</div>';
  const pct=v.duration?Math.min(100,(v.progress/v.duration)*100):0;
  const label=(v.genres&&v.genres[0])?v.genres[0]:v.type;
  const sub=v.year?(v.type+' · '+v.year):(fmtSize(v.size)+(v.duration?' · '+fmtDur(v.duration):''));
  card.innerHTML=
    '<div class="thumb">'+inner+
      '<span class="badge '+typeClass(v.type)+'">'+escapeHtml(v.type||'Video')+'</span>'+
      '<div class="play-hint"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg></div>'+
      (pct>1?'<div class="pbar"><i style="width:'+pct+'%"></i></div>':'')+
    '</div>'+
    '<div class="label">'+escapeHtml(label||'')+'</div>'+
    '<h3>'+escapeHtml(v.title)+'</h3>'+
    '<div class="sub">'+escapeHtml(sub)+'</div>';
  card.onclick=()=>openPlayer(v.id);
  return card;
}

/* ---- grid view ---- */
function renderGrid(){
  const term=($('#filter').value||'').toLowerCase();
  let items=library.filter(v=>matchesType(v)&&(!term||v.title.toLowerCase().includes(term)));
  if(filterGenre) items=items.filter(v=>(v.genres||[]).includes(filterGenre));
  items.sort((a,b)=>b.addedAt-a.addedAt);
  $('#gridTitle').textContent=filterGenre?filterGenre:'All titles';
  $('#gridCount').textContent=items.length+(items.length===1?' title':' titles');
  const g=$('#grid'); g.innerHTML='';
  if(!items.length){g.innerHTML='<p class="hint">Nothing here yet.</p>';return;}
  items.forEach(v=>{const c=makeCard(v,false);c.style.width='auto';g.appendChild(c);});
}
$('#gridBack').addEventListener('click',()=>{filterGenre=null;view='home';rebuild();});

/* ---- stats ---- */
function renderStats(){
  const n=library.length;
  const totalSize=library.reduce((s,v)=>s+(v.size||0),0);
  const totalWatch=library.reduce((s,v)=>s+(v.progress||0),0);
  const inProgress=library.filter(v=>v.progress>20&&(!v.duration||v.progress<v.duration-20)).length;
  const gcount={};
  library.forEach(v=>(v.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
  const top=Object.keys(gcount).sort((a,b)=>gcount[b]-gcount[a]).slice(0,8);
  const max=top.length?gcount[top[0]]:1;
  let html='<h2>Stats</h2><div class="stat-grid">'+
    stat(n,'Titles')+
    stat(fmtSize(totalSize),'On device')+
    stat(fmtDur(totalWatch||0),'Watched')+
    stat(inProgress,'In progress')+
  '</div>';
  if(top.length){
    html+='<h3>Genres in your library</h3>';
    top.forEach(g=>{
      html+='<div class="bar-row"><div class="bname">'+escapeHtml(g)+'</div><div class="btrack"><i style="width:'+((gcount[g]/max)*100)+'%"></i></div><div class="bval">'+gcount[g]+'</div></div>';
    });
  }else{
    html+='<p class="hint">Genres appear once you pick online covers, which bring their tags along.</p>';
  }
  $('#statsView').innerHTML=html;
}
function stat(num,lbl){return '<div class="stat"><div class="num">'+escapeHtml(String(num))+'</div><div class="lbl">'+lbl+'</div></div>';}

/* ============ nav / wiring ============ */
$('#filter').addEventListener('input',()=>{ if(view==='stats'){view='home';setNav('collections');} rebuild(); });
$('#navCollections').addEventListener('click',()=>{view='home';filterGenre=null;setNav('collections');rebuild();});
$('#navStats').addEventListener('click',()=>{view='stats';setNav('stats');rebuild();});
function setNav(which){$('#navCollections').classList.toggle('on',which==='collections');$('#navStats').classList.toggle('on',which==='stats');}
$('#addBtn').addEventListener('click',()=>$('#fileInput').click());
$('#addBtn2').addEventListener('click',()=>$('#fileInput').click());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if($('#player').classList.contains('open'))closePlayer();
    else if(overlay.classList.contains('open')){queue=[];current=null;closeModal();}
  }
});

rebuild();
