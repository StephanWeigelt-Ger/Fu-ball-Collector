/* Lokaler Zwischenspeicher im Browser (IndexedDB).
   Karten im Speicher "karten", Fotos als Blobs im Speicher "fotos".
   Ist die Dropbox verbunden (sync.js), ist sie die eigentliche Ablage; dieser Speicher
   hält eine Kopie, damit die App schnell startet und auch offline funktioniert. */
(function(root){
"use strict";
const DB_NAME="fussball-collector", DB_VERSION=1;
let dbp=null;

function open(){
  if(dbp)return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{const d=r.result;
      if(!d.objectStoreNames.contains("karten"))d.createObjectStore("karten",{keyPath:"id"});
      if(!d.objectStoreNames.contains("fotos"))d.createObjectStore("fotos",{keyPath:"id"});
      if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta",{keyPath:"key"});};
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
  return dbp;
}
function tx(store,mode,fn){
  return open().then(d=>new Promise((res,rej)=>{
    const t=d.transaction(store,mode),s=t.objectStore(store);let out;
    const r=fn(s);if(r&&"onsuccess" in r)r.onsuccess=()=>{out=r.result};
    t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);
  }));
}
function newId(){
  const a=new Uint8Array(10);crypto.getRandomValues(a);
  return Array.from(a,b=>"abcdefghijkmnpqrstuvwxyz23456789"[b%32]).join("");
}
const urls=new Map();
const listeners=new Set();
/* quelle: "lokal" (Nutzer hat etwas geändert) oder "sync" (Abgleich mit der Dropbox) */
function changed(quelle){listeners.forEach(f=>{try{f(quelle||"lokal")}catch(e){}})}
function putAll(d,store,items){return new Promise((res,rej)=>{const t=d.transaction(store,"readwrite");const s=t.objectStore(store);items.forEach(i=>s.put(i));t.oncomplete=res;t.onerror=()=>rej(t.error)})}

const Store={
  newId,
  onChange(f){listeners.add(f)},
  allCards(){return tx("karten","readonly",s=>s.getAll()).then(a=>a||[])},
  async putCard(c){if(!c.id)c.id=newId();c.geaendert=new Date().toISOString();await tx("karten","readwrite",s=>s.put(c));changed();return c},
  async deleteCard(id){await tx("karten","readwrite",s=>s.delete(id));
    const g=(await Store.getMeta("geloescht"))||{};g[id]=new Date().toISOString();await Store.setMeta("geloescht",g);changed()},
  /* Ersetzt alle Karten durch den abgeglichenen Stand (nur für sync.js). */
  async replaceAll(karten,geloescht){const d=await open();
    await new Promise((res,rej)=>{const t=d.transaction("karten","readwrite");const s=t.objectStore("karten");s.clear();karten.forEach(c=>s.put(c));t.oncomplete=res;t.onerror=()=>rej(t.error)});
    await Store.setMeta("geloescht",geloescht||{});changed("sync")},
  async putPhoto(blob,id,hochgeladen){id=id||newId();await tx("fotos","readwrite",s=>s.put({id,blob,type:blob.type||"image/jpeg",hochgeladen:!!hochgeladen}));return id},
  getPhotoRecord(id){return tx("fotos","readonly",s=>s.get(id))},
  async markUploaded(id){const r=await Store.getPhotoRecord(id);if(r){r.hochgeladen=true;await tx("fotos","readwrite",s=>s.put(r))}},
  /* Wird gesetzt, wenn ein Foto lokal fehlt, aber aus der Dropbox geladen werden kann (sync.js). */
  fetchMissingPhoto:null,
  getPhoto(id){return tx("fotos","readonly",s=>s.get(id)).then(r=>r?r.blob:null)},
  async deletePhoto(id){const r=await Store.getPhotoRecord(id);
    if(!r||r.hochgeladen){const q=(await Store.getMeta("fotosLoeschen"))||[];if(!q.includes(id)){q.push(id);await Store.setMeta("fotosLoeschen",q)}}
    await tx("fotos","readwrite",s=>s.delete(id));const u=urls.get(id);if(u){URL.revokeObjectURL(u);urls.delete(id)}},
  /* Liefert eine anzeigbare URL für ein Foto (zwischengespeichert). */
  async photoURL(id){if(!id)return "";if(urls.has(id))return urls.get(id);let b=await Store.getPhoto(id);
    if(!b&&Store.fetchMissingPhoto){try{b=await Store.fetchMissingPhoto(id);if(b)await Store.putPhoto(b,id,true)}catch(e){}}
    if(!b)return "";if(urls.has(id))return urls.get(id);const u=URL.createObjectURL(b);urls.set(id,u);return u},
  getMeta(key){return tx("meta","readonly",s=>s.get(key)).then(r=>r?r.value:undefined)},
  setMeta(key,value){return tx("meta","readwrite",s=>s.put({key,value}))},

  /* Sicherung: eine JSON-Datei mit allen Karten und Fotos (als data-URL). */
  async exportBackup(){
    const karten=await Store.allCards();const fotos={};
    for(const c of karten)for(const id of [c.fotoVorne,c.fotoHinten,c.fotoVorneOriginal,c.fotoHintenOriginal]){
      if(!id||fotos[id])continue;const b=await Store.getPhoto(id);if(b)fotos[id]=await blobToDataURL(b)}
    return {app:"Fussball-Collector",format:1,exportiert:new Date().toISOString(),karten,fotos};
  },
  async importBackup(obj){
    if(!obj||obj.app!=="Fussball-Collector"||!Array.isArray(obj.karten))throw new Error("Keine gültige Fußball-Collector-Sicherung.");
    const fotos=obj.fotos||{};let neu=0,akt=0;const jetzt=new Date().toISOString();
    const vorhanden=new Set((await Store.allCards()).map(c=>c.id));
    const d=await open();
    for(const [id,url] of Object.entries(fotos)){
      if(typeof url!=="string"||!/^data:image\//.test(url))continue;
      const blob=dataURLToBlob(url);
      await putAll(d,"fotos",[{id,blob,type:blob.type,hochgeladen:false}]);
    }
    for(const c of obj.karten){if(!c||typeof c!=="object"||!(c.spieler||c.fotoVorne))continue;if(!c.id)c.id=newId();
      vorhanden.has(c.id)?akt++:neu++;c.geaendert=jetzt;
      await putAll(d,"karten",[c]);}
    const g=(await Store.getMeta("geloescht"))||{};let gg=false;for(const c of obj.karten)if(c&&c.id&&g[c.id]){delete g[c.id];gg=true}
    if(gg)await Store.setMeta("geloescht",g);
    changed();return {neu,akt};
  }
};
function blobToDataURL(b){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(b)})}
function dataURLToBlob(u){const i=u.indexOf(",");const meta=u.slice(5,i);const type=meta.split(";")[0]||"image/jpeg";
  const bin=atob(u.slice(i+1));const a=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)a[k]=bin.charCodeAt(k);return new Blob([a],{type})}

root.Store=Store;
})(window);
