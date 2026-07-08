/* Reel — Offline Library. Plain classic scripts, load order: core.js, player.js, index.js. Globals are shared across files. */

/* ============ player ============ */
let currentShow=null, currentPlaying=null, currentUrl=null, lastCompleted=false;
const pVideo=$('#pVideo');

async function openShow(key, epId){
  const show=groupShows(library).find(s=>s.key===key); if(!show)return;
  currentShow=show;
  let ep = epId ? show.episodes.find(e=>e.id===epId) : null;
  if(!ep) ep = show.resume || show.episodes.find(e=>!isCompleted(e)) || show.episodes[0];
  $('#player').classList.add('open');
  const multi = show.episodes.length>1;
  $('#pEpisodes').style.display = multi ? 'inline-flex' : 'none';
  $('#pDelete').innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1L7 9Z"/></svg> '+(multi?'Delete episode':'Delete');
  if(multi && window.innerWidth>720) $('#player').classList.add('panel-open');
  else $('#player').classList.remove('panel-open');
  renderEpisodes();
  await playEpisode(ep);
}
// thin wrapper for any single-item entry points
function openPlayer(id){ const v=library.find(x=>x.id===id); if(!v)return; openShow(normShow(v.show||v.title), id); }

async function playEpisode(ep){
  if(!ep||!currentShow)return;
  if(currentPlaying && currentPlaying.id!==ep.id) persistProgress();
  const blob=await idbGet(ep.id);
  if(!blob){toast('That video file is missing from this device.',true);return;}
  currentPlaying=ep;
  if(currentUrl)URL.revokeObjectURL(currentUrl);
  currentUrl=URL.createObjectURL(blob);
  pVideo.src=currentUrl;
  pVideo.onloadedmetadata=()=>{
    if(currentPlaying && pVideo.duration && isFinite(pVideo.duration) && currentPlaying.duration!==pVideo.duration){
      currentPlaying.duration=pVideo.duration; saveLibrary(); updateEpisodeHighlight();
    }
  };
  const label=epLabelFor(currentShow,ep);
  $('#pTitle').textContent=currentShow.name+(label?('   ·   '+label):'');
  pVideo.currentTime=(ep.progress&&ep.progress<((ep.duration||1)-5))?ep.progress:0;
  pVideo.play().catch(()=>{});
  lastCompleted=isCompleted(ep);
  updateEpisodeHighlight();
}

function persistProgress(){
  if(!currentPlaying)return;
  currentPlaying.progress=pVideo.currentTime;
  if(!currentPlaying.duration&&pVideo.duration)currentPlaying.duration=pVideo.duration;
  currentPlaying.lastWatched=Date.now();
  saveLibrary();
}

function renderEpisodes(){
  const scroll=$('#epScroll');
  if(!currentShow||currentShow.episodes.length<=1){scroll.innerHTML='';return;}
  const bySeason={};
  currentShow.episodes.forEach(e=>{(bySeason[e.season||1]=bySeason[e.season||1]||[]).push(e);});
  const seasons=Object.keys(bySeason).map(Number).sort((a,b)=>a-b);
  let html='';
  seasons.forEach(sn=>{
    if(currentShow.multiSeason) html+='<div class="ep-season">Season '+sn+'</div>';
    html+='<div class="ep-grid">';
    bySeason[sn].forEach((e,i)=>{
      const num=e.episode!=null?e.episode:(i+1);
      html+='<button class="ep-sq" data-id="'+e.id+'">'+num+'</button>';
    });
    html+='</div>';
  });
  scroll.innerHTML=html;
  scroll.querySelectorAll('.ep-sq').forEach(b=>b.onclick=()=>{
    const ep=currentShow.episodes.find(x=>x.id===b.dataset.id);
    if(ep) playEpisode(ep);
  });
  updateEpisodeHighlight();
}
function updateEpisodeHighlight(){
  if(!currentShow)return;
  document.querySelectorAll('#epScroll .ep-sq').forEach(b=>{
    const ep=currentShow.episodes.find(x=>x.id===b.dataset.id); if(!ep)return;
    const done=isCompleted(ep);
    b.classList.toggle('current', !!currentPlaying && ep.id===currentPlaying.id);
    b.classList.toggle('done', done);
    b.classList.toggle('watching', !done && (ep.progress||0)>20);
  });
}

let saveTick=0;
pVideo.addEventListener('timeupdate',()=>{
  if(!currentPlaying)return;
  const now=Date.now();
  if(now-saveTick>4000){saveTick=now;persistProgress();}
  const done=isCompleted(currentPlaying);
  if(done!==lastCompleted){ lastCompleted=done; updateEpisodeHighlight(); }
});
pVideo.addEventListener('ended',()=>{
  if(!currentShow||!currentPlaying)return;
  persistProgress(); updateEpisodeHighlight();
  const i=currentShow.episodes.findIndex(e=>e.id===currentPlaying.id);
  const next=currentShow.episodes[i+1];
  if(next) playEpisode(next);
});

$('#pEpisodes').addEventListener('click',()=>$('#player').classList.toggle('panel-open'));
$('#epClose').addEventListener('click',()=>$('#player').classList.remove('panel-open'));

function closePlayer(){
  if(currentPlaying){persistProgress();rebuild();}
  pVideo.pause();
  if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null;}
  pVideo.removeAttribute('src');pVideo.load();
  $('#player').classList.remove('open');$('#player').classList.remove('panel-open');
  currentShow=null; currentPlaying=null;
}
$('#pClose').addEventListener('click',closePlayer);

$('#pDelete').addEventListener('click',async ()=>{
  if(!currentPlaying||!currentShow)return;
  const multi=currentShow.episodes.length>1;
  const label=epLabelFor(currentShow,currentPlaying);
  const name=currentShow.name+(label?(' '+label):'');
  if(!confirm('Delete “'+name+'” from this device? This cannot be undone.'))return;
  const delId=currentPlaying.id;
  await idbDel(delId);
  library=library.filter(x=>x.id!==delId);
  saveLibrary();
  const show=groupShows(library).find(s=>s.key===currentShow.key);
  if(show && show.episodes.length){
    currentShow=show;
    $('#pEpisodes').style.display = show.episodes.length>1 ? 'inline-flex' : 'none';
    renderEpisodes();
    await playEpisode(show.episodes[0]);
    rebuild();
    toast('Deleted “'+name+'”');
  }else{
    closePlayer();
    toast('Deleted “'+name+'”');
  }
});

async function deleteShow(key){
  const show=groupShows(library).find(s=>s.key===key); if(!show)return;
  const n=show.episodes.length;
  if(!confirm('Delete “'+show.name+'”'+(n>1?(' and all '+n+' episodes'):'')+' from this device? This cannot be undone.'))return;
  const ids=new Set(show.episodes.map(e=>e.id));
  for(const id of ids){ await idbDel(id); }
  library=library.filter(x=>!ids.has(x.id));
  saveLibrary();
  if(currentShow && currentShow.key===key) closePlayer();
  rebuild();
  toast('Deleted “'+show.name+'”');
}
