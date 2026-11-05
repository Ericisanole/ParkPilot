'use strict';
// User-supplied Magic Night illustrations. One stable identity for each park.
const PARK_ARTWORK=Object.freeze({
 mk:'./park-art-mk.webp',ep:'./park-art-ep.webp',hs:'./park-art-hs.webp',
 ak:'./park-art-ak.webp',dl:'./park-art-dl.webp',ca:'./park-art-ca.webp'
});
let parkArtBackdrop=null,parkArtHero=null,parkArtRequested='',parkArtCommitted='',parkArtSequence=0;
function createParkArtHost(className){
 const host=document.createElement('div');host.className=className;host.setAttribute('aria-hidden','true');return host;
}
function setParkArtLayer(host,source,park){
 if(host.dataset.park===park)return;
 const outgoing=[...host.children];
 const layer=document.createElement('img');layer.className='park-art-layer';layer.alt='';layer.src=source;layer.decoding='async';layer.draggable=false;
 host.append(layer);host.dataset.park=park;
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(!outgoing.length||reduced){layer.classList.add('is-visible');outgoing.forEach(old=>old.remove());return;}
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  if(host.lastElementChild!==layer)return;
  layer.classList.add('is-visible');outgoing.forEach(old=>old.classList.remove('is-visible'));
 }));
 setTimeout(()=>outgoing.forEach(old=>old.remove()),550);
}
function syncParkArtwork(park){
 const source=PARK_ARTWORK[park];if(!source)return;
 if(!parkArtBackdrop){parkArtBackdrop=createParkArtHost('park-art-backdrop');document.body.prepend(parkArtBackdrop);}
 if(!parkArtHero)parkArtHero=createParkArtHost('park-hero-art');
 const hero=document.querySelector('.hero');if(hero&&!hero.contains(parkArtHero))hero.prepend(parkArtHero);
 // Reuse the same hero layers through live-data renders so a refresh never restarts motion.
 if(parkArtRequested===park)return;
 parkArtRequested=park;const sequence=++parkArtSequence;
 const image=new Image();image.decoding='async';
 image.onload=async()=>{
  try{await image.decode();}catch{}
  if(sequence!==parkArtSequence)return;
  setParkArtLayer(parkArtBackdrop,source,park);setParkArtLayer(parkArtHero,source,park);
  document.body.style.setProperty('--park-artwork',`url("${source}")`);
  parkArtCommitted=park;
 };
 image.onerror=()=>{
  if(sequence!==parkArtSequence)return;
  parkArtRequested='';parkArtCommitted='';
  // A missing asset must not leave a different park's landmark on screen.
  parkArtBackdrop.replaceChildren();parkArtHero.replaceChildren();delete parkArtBackdrop.dataset.park;delete parkArtHero.dataset.park;
  document.body.style.removeProperty('--park-artwork');
 };
 image.src=source;
}
