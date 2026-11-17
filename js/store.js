/* Lokale Datenhaltung im Browser (IndexedDB).
   Alles bleibt auf dem Gerät: Karten im Speicher "karten", Fotos als Blobs im Speicher "fotos". */
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
function changed(){listeners.forEach(f=>{try{f()}catch(e){}})}

const Store={
  newId,
  onChange(f){listeners.add(f)},
  allCards(){return tx("karten","readonly",s=>s.getAll()).then(a=>a||[])},
  async putCard(c){if(!c.id)c.id=newId();await tx("karten","readwrite",s=>s.put(c));changed();return c},
  async deleteCard(id){await tx("karten","readwrite",s=>s.delete(id));changed()},
  async putPhoto(blob){const id=newId();await tx("fotos","readwrite",s=>s.put({id,blob,type:blob.type||"image/jpeg"}));return id},
  getPhoto(id){return tx("fotos","readonly",s=>s.get(id)).then(r=>r?r.blob:null)},
  async deletePhoto(id){await tx("fotos","readwrite",s=>s.delete(id));const u=urls.get(id);if(u){URL.revokeObjectURL(u);urls.delete(id)}},
  /* Liefert eine anzeigbare URL für ein Foto (zwischengespeichert). */
  async photoURL(id){if(!id)return "";if(urls.has(id))return urls.get(id);const b=await Store.getPhoto(id);if(!b)return "";const u=URL.createObjectURL(b);urls.set(id,u);return u},
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
    const fotos=obj.fotos||{};let neu=0,akt=0;
    const vorhanden=new Set((await Store.allCards()).map(c=>c.id));
    const d=await open();
    for(const [id,url] of Object.entries(fotos)){
      if(typeof url!=="string"||!/^data:image\//.test(url))continue;
      const blob=dataURLToBlob(url);
      await new Promise((res,rej)=>{const t=d.transaction("fotos","readwrite");t.objectStore("fotos").put({id,blob,type:blob.type});t.oncomplete=res;t.onerror=()=>rej(t.error)});
    }
    for(const c of obj.karten){if(!c||typeof c!=="object"||!c.spieler)continue;if(!c.id)c.id=newId();
      vorhanden.has(c.id)?akt++:neu++;
      await new Promise((res,rej)=>{const t=d.transaction("karten","readwrite");t.objectStore("karten").put(c);t.oncomplete=res;t.onerror=()=>rej(t.error)});}
    changed();return {neu,akt};
  }
};
function blobToDataURL(b){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(b)})}
function dataURLToBlob(u){const i=u.indexOf(",");const meta=u.slice(5,i);const type=meta.split(";")[0]||"image/jpeg";
  const bin=atob(u.slice(i+1));const a=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)a[k]=bin.charCodeAt(k);return new Blob([a],{type})}

root.Store=Store;
})(window);
