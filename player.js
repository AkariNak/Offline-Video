/* Reel — Offline Library. Plain classic scripts, load order: core.js, player.js, index.js. Globals are shared across files. */

/* ============ player ============ */
let currentPlaying=null, currentUrl=null;
const pVideo=$('#pVideo');
async function openPlayer(id){
  const v=library.find(x=>x.id===id); if(!v)return;
  const blob=await idbGet(id);
  if(!blob){toast('That video file is missing from this device.',true);return;}
  currentPlaying=v;
  if(currentUrl)URL.revokeObjectURL(currentUrl);
  currentUrl=URL.createObjectURL(blob);
  pVideo.src=currentUrl;
  $('#pTitle').textContent=v.title;
  $('#player').classList.add('open');
  pVideo.currentTime=(v.progress&&v.progress<(v.duration-5))?v.progress:0;
  pVideo.play().catch(()=>{});
}
let saveTick=0;
pVideo.addEventListener('timeupdate',()=>{
  if(!currentPlaying)return;
  const now=Date.now();
  if(now-saveTick>4000){saveTick=now;currentPlaying.progress=pVideo.currentTime;if(!currentPlaying.duration&&pVideo.duration)currentPlaying.duration=pVideo.duration;saveLibrary();}
});
function closePlayer(){
  if(currentPlaying){currentPlaying.progress=pVideo.currentTime;saveLibrary();rebuild();}
  pVideo.pause();
  if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=null;}
  pVideo.removeAttribute('src');pVideo.load();
  $('#player').classList.remove('open'); currentPlaying=null;
}
$('#pClose').addEventListener('click',closePlayer);
$('#pDelete').addEventListener('click',()=>{ if(currentPlaying) deleteItem(currentPlaying.id,currentPlaying.title,true); });
async function deleteItem(id,title,fromPlayer){
  if(!confirm('Delete “'+title+'” from this device? This cannot be undone.'))return;
  await idbDel(id);
  library=library.filter(x=>x.id!==id);
  saveLibrary();
  if(fromPlayer) closePlayer();
  rebuild();
  toast('Deleted.');
}
