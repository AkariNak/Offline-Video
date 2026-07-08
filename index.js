/* Reel — Offline Library. Plain classic scripts, load order: core.js, player.js, index.js. Globals are shared across files. */

/* ============ add flow / modal (batch by show) ============ */
let queue=[], current=null, selectedCover=null, selectedMeta=null, captureToken=0;
const overlay=$('#overlay');
$('#fileInput').addEventListener('change',e=>{
  const files=[...e.target.files].filter(f=>f.type.startsWith('video/')||/\.(mp4|webm|ogv|mov|mkv|m4v)$/i.test(f.name));
  e.target.value='';
  if(!files.length){toast('No video files selected.',true);return;}
  queue=groupFiles(files); nextGroup();
});
function groupFiles(files){
  const map=new Map();
  files.forEach(f=>{
    const base=cleanTitle(f.name), ep=parseEpisode(f.name), key=normShow(base);
    if(!map.has(key)) map.set(key,{key,name:base,files:[]});
    map.get(key).files.push({file:f,season:ep.season,episode:ep.episode,fname:f.name});
  });
  const groups=[...map.values()];
  groups.forEach(g=>g.files.sort((a,b)=>
    ((a.season||1)-(b.season||1)) ||
    (((a.episode==null?1e9:a.episode))-((b.episode==null?1e9:b.episode))) ||
    a.fname.localeCompare(b.fname)));
  return groups;
}
async function nextGroup(){
  if(!queue.length){closeModal();return;}
  current=queue.shift(); current.still=null;
  selectedCover=null; selectedMeta=null;
  await openGroupModal(current, queue.length);
}
async function openGroupModal(group,remaining){
  const multi=group.files.length>1;
  const myToken=++captureToken;
  $('#mTitle').textContent = multi?'Add show':'Add title';
  $('#mName').value=group.name;
  $('#mType').value='Show';
  $('#mSeason').value='';
  $('#mQueue').textContent=remaining>0?(remaining+' more show'+(remaining>1?'s':'')+' queued'):'';
  $('#mSave').textContent = multi?('Add '+group.files.length+' episodes'):'Save to library';
  $('#mSearchState').innerHTML='';
  const covers=$('#mCovers'); covers.innerHTML=''; addUploadTile(covers);
  renderEpList(group);
  overlay.classList.add('open'); $('#mName').focus();

  const {frames}=await captureFrames(group.files[0].file, multi?6:12);
  if(frames.length){
    group.still=frames[Math.floor(frames.length/2)]||frames[0];
    frames.forEach((f,i)=>{
      const tile=coverTile(f,'data',f,null);
      covers.insertBefore(tile,covers.querySelector('.upload'));
      if(i===0) selectCover(tile,{kind:'data',value:f},null);
    });
  }else{
    const n=document.createElement('p'); n.className='hint';
    n.textContent='Could not read frames from these files (the browser may not decode this format). Try Find covers or upload your own.';
    $('#mSearchState').appendChild(n);
  }

  const ex=existingShowMeta(group.name);
  if(ex && ex.cover){
    const meta={type:ex.type,genres:ex.genres,synopsis:ex.synopsis,year:ex.year,score:ex.score};
    const tile=coverTile(ex.cover, ex.coverType==='url'?'url':'data', ex.cover, meta);
    covers.insertBefore(tile,covers.firstChild);
    selectCover(tile,{kind:ex.coverType==='url'?'url':'data',value:ex.cover},meta);
    $('#mType').value=ex.type||'Show';
    const note=document.createElement('p'); note.className='hint';
    note.textContent='Reusing the cover and genres from \u201c'+ex.name+'\u201d already in your library.';
    $('#mSearchState').appendChild(note);
  }else{
    runOnlineSearch(group.name,true);
  }
  captureMoreCovers(group,myToken);
}
async function captureMoreCovers(group,token){
  if(!group||group.files.length<=1) return;
  const covers=$('#mCovers');
  const maxExtra=10, perEp=3, capTiles=42;
  const step=Math.max(1,Math.round((group.files.length-1)/maxExtra));
  const idxs=[];
  for(let k=1;k<group.files.length && idxs.length<maxExtra;k+=step) idxs.push(k);
  const hint=document.createElement('p'); hint.className='hint'; hint.id='mMoreHint';
  hint.textContent='Adding more cover options from other episodes\u2026';
  $('#mSearchState').appendChild(hint);
  for(const k of idxs){
    if(token!==captureToken) return;
    let res; try{ res=await captureFrames(group.files[k].file,perEp); }catch(e){ continue; }
    if(token!==captureToken) return;
    (res.frames||[]).forEach(f=>{
      if(covers.querySelectorAll('.cover-opt:not(.upload)').length>=capTiles) return;
      const tile=coverTile(f,'data',f,null);
      covers.insertBefore(tile,covers.querySelector('.upload'));
    });
  }
  const h=$('#mMoreHint'); if(h) h.remove();
}
function renderEpList(group){
  const multi=group.files.length>1;
  $('#mEpCount').textContent='('+group.files.length+')';
  const list=$('#mEpList'); list.innerHTML='';
  group.files.forEach((it,i)=>{
    const def = it.episode!=null ? it.episode : (multi?(i+1):'');
    const row=document.createElement('div'); row.className='ep-list-row';
    row.innerHTML='<input class="ep-num" type="number" min="1" value="'+def+'" '+(multi?'':'placeholder="\u2014"')+' aria-label="Episode number"><span class="ep-file" title="'+escapeAttr(it.fname)+'">'+escapeHtml(it.fname)+'</span>';
    list.appendChild(row);
  });
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
$('#mName').addEventListener('input',e=>{if(current)current.name=e.target.value;});
$('#mFind').addEventListener('click',()=>runOnlineSearch($('#mName').value,false));
async function runOnlineSearch(title,quiet){
  if(!title||!title.trim()){if(!quiet)toast('Type a title first.',true);return;}
  const state=$('#mSearchState');
  state.innerHTML='<div class="searching"><span class="spinner"></span> Looking for \u201c'+escapeHtml(title.trim())+'\u201d covers\u2026</div>';
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
$('#mSave').addEventListener('click',saveGroup);
async function saveGroup(){
  if(!current)return;
  const show=($('#mName').value||'Untitled').trim();
  const sOverride=parseInt($('#mSeason').value,10);
  const seasonOverride=(!sOverride||sOverride<1)?null:sOverride;
  const rows=[...$('#mEpList').querySelectorAll('.ep-num')];
  const multi=current.files.length>1;

  let coverType='none',cover='';
  if(selectedCover){
    if(selectedCover.kind==='data'){coverType='data';cover=selectedCover.value;}
    else{try{cover=await urlToDataURL(selectedCover.value);coverType='data';}catch(e){cover=selectedCover.value;coverType='url';}}
  }
  let m=selectedMeta||{};
  if(!m.genres||!m.genres.length){const ex=existingShowMeta(show); if(ex){m={type:ex.type,genres:ex.genres,synopsis:ex.synopsis,year:ex.year,score:ex.score};}}
  const type=$('#mType').value||m.type||'Show';

  $('#mSave').disabled=true;
  let saved=0;
  for(let i=0;i<current.files.length;i++){
    const it=current.files[i];
    const raw=((rows[i]&&rows[i].value)||'').trim();
    let episode = raw==='' ? (multi?(i+1):null) : parseInt(raw,10);
    if(episode!=null&&(isNaN(episode)||episode<1)) episode=null;
    const season = seasonOverride!=null ? seasonOverride : (it.season||1);
    const id=uid();
    try{ await idbPut(id,it.file); }
    catch(e){ toast('Could not save \u201c'+it.fname+'\u201d. It may be too large.',true); continue; }
    library.unshift({
      id, title:show, show, season, episode, type,
      coverType, cover, still:current.still||null,
      genres:m.genres||[], synopsis:m.synopsis||'', year:m.year||null, score:m.score||null,
      duration:0, size:it.file.size, mime:it.file.type,
      addedAt:Date.now()+i, progress:0, lastWatched:0
    });
    saved++;
  }
  saveLibrary(); rebuild();
  $('#mSave').disabled=false;
  toast(multi? ('Added '+saved+' episodes to \u201c'+show+'\u201d') : ('Added \u201c'+show+'\u201d'));
  current=null; nextGroup();
}
$('#mSkip').addEventListener('click',()=>{current=null;nextGroup();});
$('#mClose').addEventListener('click',()=>{queue=[];current=null;closeModal();});
overlay.addEventListener('click',e=>{if(e.target===overlay){queue=[];current=null;closeModal();}});
function closeModal(){captureToken++;overlay.classList.remove('open');}

/* ============ view state ============ */
let filterType='All', filterGenre=null, view='home'; // home | grid | stats
let heroItems=[], heroIndex=0, heroTimer=null;
let SHOWS=[];

function rebuild(){
  const has=library.length>0;
  SHOWS=groupShows(library);
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

function matchesType(s){return filterType==='All'||s.type===filterType;}
function searchTerm(){return ($('#filter').value||'').toLowerCase();}
function baseShows(){const t=searchTerm();return SHOWS.filter(s=>matchesType(s)&&(!t||s.name.toLowerCase().includes(t)));}
function epLabelFor(show,ep){ if(!ep||ep.episode==null)return ''; return (show.multiSeason?('S'+ep.season+' '):'')+'E'+ep.episode; }

/* ---- hero ---- */
function renderHero(){
  const pool=baseShows();
  heroItems=pool.filter(s=>s.cover||s.still).slice(0,6);
  if(!heroItems.length) heroItems=pool.slice(0,6);
  if(!heroItems.length){$('#hero').style.display='none';return;}
  if(heroIndex>=heroItems.length) heroIndex=0;
  drawHero();
  clearInterval(heroTimer);
  if(heroItems.length>1) heroTimer=setInterval(()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();},7000);
}
function drawHero(){
  const s=heroItems[heroIndex]; if(!s)return;
  const bg=s.cover||s.still||'';
  const posterInner=(s.cover)?'<img alt="" src="'+s.cover+'">':(s.still?'<img alt="" src="'+s.still+'">':'<div class="ph">'+(s.name[0]||'?').toUpperCase()+'</div>');
  const desc=s.synopsis?escapeHtml(s.synopsis):(s.count>1?(s.count+' episodes saved on this device'):('Saved on this device · '+fmtSize(s.size)));
  const tags=[];
  if(s.type)tags.push(s.type);
  if(s.count>1)tags.push(s.count+' episodes');
  if(s.year)tags.push(s.year);
  if(s.score)tags.push('★ '+s.score);
  (s.genres||[]).slice(0,3).forEach(g=>tags.push(g));
  const dots=heroItems.map((_,i)=>'<i class="'+(i===heroIndex?'on':'')+'" data-i="'+i+'"></i>').join('');
  $('#hero').innerHTML=
    (bg?'<div class="hero-bg" style="background-image:url('+"'"+bg+"'"+')"></div>':'<div class="hero-bg" style="background:linear-gradient(135deg,#141824,#1a1f2e)"></div>')+
    '<div class="hero-nav">'+
      (heroItems.length>1?'<button class="arrow" id="hPrev" aria-label="Previous"><svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6 1.4-1.4L11.8 12l4.6-4.6L15 6Z"/></svg></button><div class="dots">'+dots+'</div><button class="arrow" id="hNext" aria-label="Next"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6-1.4-1.4L12.2 12 7.6 7.4 9 6Z"/></svg></button>':'')+
    '</div>'+
    '<div class="hero-inner">'+
      '<div class="hero-poster">'+posterInner+'</div>'+
      '<div class="hero-text">'+
        '<div class="hero-eyebrow">'+escapeHtml(s.type||'Video')+'</div>'+
        '<div class="hero-title">'+escapeHtml(s.name)+'</div>'+
        '<div class="hero-desc">'+desc+'</div>'+
        (tags.length?'<div class="hero-tags">'+tags.map(t=>'<span>'+escapeHtml(String(t))+'</span>').join('')+'</div>':'')+
        '<div class="hero-actions">'+
          '<button class="btn primary" id="hPlay"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg> '+(s.resume?'Resume':'Watch now')+'</button>'+
          '<button class="btn danger ghost" id="hDelete"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1L7 9Z"/></svg> Delete</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  const play=$('#hPlay'); if(play)play.onclick=()=>openShow(s.key);
  const del=$('#hDelete'); if(del)del.onclick=()=>deleteShow(s.key);
  const prev=$('#hPrev'); if(prev)prev.onclick=()=>{heroIndex=(heroIndex-1+heroItems.length)%heroItems.length;drawHero();resetHeroTimer();};
  const next=$('#hNext'); if(next)next.onclick=()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();resetHeroTimer();};
  document.querySelectorAll('#hero .dots i').forEach(d=>d.onclick=()=>{heroIndex=+d.dataset.i;drawHero();resetHeroTimer();});
}
function resetHeroTimer(){clearInterval(heroTimer);if(heroItems.length>1)heroTimer=setInterval(()=>{heroIndex=(heroIndex+1)%heroItems.length;drawHero();},7000);}

/* ---- filters ---- */
function renderFilters(){
  const types=['All','Show','Movie','OVA'];
  const labelMap={All:'All',Show:'Shows',Movie:'Movies',OVA:'OVA'};
  $('#typeTabs').innerHTML=types.map(t=>'<button class="'+(filterType===t?'on':'')+'" data-t="'+t+'">'+labelMap[t]+'</button>').join('');
  document.querySelectorAll('#typeTabs button').forEach(b=>b.onclick=()=>{filterType=b.dataset.t;heroIndex=0;rebuild();});

  const gcount={};
  SHOWS.filter(matchesType).forEach(s=>(s.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
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
  const base=baseShows();
  const rows=$('#rows'); rows.innerHTML='';

  const continuing=base.filter(s=>s.resume).sort((a,b)=>(b.resume.lastWatched||0)-(a.resume.lastWatched||0));
  if(continuing.length) rows.appendChild(buildRow('Continue watching',continuing,true,null));

  const recent=[...base].sort((a,b)=>b.addedAt-a.addedAt);
  if(recent.length) rows.appendChild(buildRow('Recently added',recent,false,'__recent'));

  const gcount={};
  base.forEach(s=>(s.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
  Object.keys(gcount).sort((a,b)=>gcount[b]-gcount[a]).slice(0,8).forEach(g=>{
    const items=base.filter(s=>(s.genres||[]).includes(g)).sort((a,b)=>b.addedAt-a.addedAt);
    if(items.length) rows.appendChild(buildRow(g,items,false,g));
  });

  if(!continuing.length && !recent.length){
    rows.innerHTML='<p class="hint" style="padding:0 34px">No titles match your filters.</p>';
  }
}
function buildRow(title,shows,landscape,viewAllKey){
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
  shows.forEach(s=>sc.appendChild(makeCard(s,landscape)));
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
function makeCard(s,landscape){
  const card=document.createElement('div');
  card.className='card '+(landscape?'land':'portrait');
  const resume=s.resume||s.episodes[0];
  const img=landscape?(resume.still||s.still||s.cover):(s.cover||s.still);
  const inner=img?'<img alt="'+escapeAttr(s.name)+'" loading="lazy" src="'+img+'">':'<div class="ph">'+(s.name[0]||'?').toUpperCase()+'</div>';
  const label=(s.genres&&s.genres[0])?s.genres[0]:s.type;
  let pct=0, sub;
  if(landscape){
    pct=resume.duration?Math.min(100,((resume.progress||0)/resume.duration)*100):0;
    const el=epLabelFor(s,resume);
    sub=(el?el+' · ':'')+'Resume';
  }else{
    if(s.count>1){ sub=s.count+' episodes'; }
    else{ const e=s.episodes[0]; sub=s.year?(s.type+' · '+s.year):(fmtSize(s.size)+(e.duration?' · '+fmtDur(e.duration):'')); pct=e.duration?Math.min(100,((e.progress||0)/e.duration)*100):0; }
  }
  const badge = s.count>1 ? (s.count+' EP') : (s.type||'Video');
  const badgeClass = s.count>1 ? '' : typeClass(s.type);
  card.innerHTML=
    '<div class="thumb">'+inner+
      '<span class="badge '+badgeClass+'">'+escapeHtml(badge)+'</span>'+
      '<div class="play-hint"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg></div>'+
      (pct>1?'<div class="pbar"><i style="width:'+pct+'%"></i></div>':'')+
    '</div>'+
    '<div class="label">'+escapeHtml(label||'')+'</div>'+
    '<h3>'+escapeHtml(s.name)+'</h3>'+
    '<div class="sub">'+escapeHtml(sub)+'</div>';
  card.onclick=()=> landscape ? openShow(s.key, resume.id) : openShow(s.key);
  return card;
}

/* ---- grid view ---- */
function renderGrid(){
  let items=baseShows();
  if(filterGenre) items=items.filter(s=>(s.genres||[]).includes(filterGenre));
  items.sort((a,b)=>b.addedAt-a.addedAt);
  $('#gridTitle').textContent=filterGenre?filterGenre:'All titles';
  $('#gridCount').textContent=items.length+(items.length===1?' title':' titles');
  const g=$('#grid'); g.innerHTML='';
  if(!items.length){g.innerHTML='<p class="hint">Nothing here yet.</p>';return;}
  items.forEach(s=>{const c=makeCard(s,false);c.style.width='auto';g.appendChild(c);});
}
$('#gridBack').addEventListener('click',()=>{filterGenre=null;view='home';rebuild();});

/* ---- stats ---- */
function renderStats(){
  const shows=groupShows(library);
  const totalSize=library.reduce((s,v)=>s+(v.size||0),0);
  const totalWatch=library.reduce((s,v)=>s+(v.progress||0),0);
  const inProgress=shows.filter(s=>s.resume).length;
  const gcount={};
  shows.forEach(s=>(s.genres||[]).forEach(g=>gcount[g]=(gcount[g]||0)+1));
  const top=Object.keys(gcount).sort((a,b)=>gcount[b]-gcount[a]).slice(0,8);
  const max=top.length?gcount[top[0]]:1;
  let html='<h2>Stats</h2><div class="stat-grid">'+
    stat(shows.length,'Shows')+
    stat(library.length,'Episodes')+
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
