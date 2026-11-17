/* Abgleich mit der Dropbox des Nutzers.
   Jeder Nutzer meldet sich mit seiner eigenen Dropbox an. Die App sieht nur ihren Ordner
   "Apps/<App-Name>" (Zugriffsart "App folder"). Darin liegen:
     /karten.json        alle Karten und eine Liste gelöschter Karten
     /fotos/<id>.jpg     die Fotos
   Anmeldung: OAuth 2 mit PKCE, ohne Server und ohne App-Secret. */
(function(root){
"use strict";
const API="https://api.dropboxapi.com", CONTENT="https://content.dropboxapi.com";
const KEY=()=>(root.APP_CONFIG&&root.APP_CONFIG.DROPBOX_APP_KEY)||"";
const redirectUri=()=>location.origin+location.pathname.replace(/index\.html$/,"");

let auth=null;            // {refresh, access, expires, name}
let status={state:"aus",text:"",when:null};
const listeners=new Set();
function setStatus(state,text){status={state,text,when:new Date()};listeners.forEach(f=>{try{f(status)}catch(e){}})}

/* ---------- Hilfsfunktionen ---------- */
function b64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function randomString(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return b64url(a)}
async function sha256(s){return new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))}
// Dropbox verlangt im Header ASCII; alles andere als \uXXXX
function headerJson(o){return JSON.stringify(o).replace(/[\u007f-￿]/g,c=>"\\u"+("000"+c.charCodeAt(0).toString(16)).slice(-4))}
class DbxError extends Error{constructor(status,summary){super(summary||("HTTP "+status));this.status=status;this.summary=summary||""}}

async function saveAuth(){await Store.setMeta("dropbox",auth)}

async function tokenRequest(params){
  const r=await fetch(API+"/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new DbxError(r.status,[j.error,j.error_description].filter(Boolean).join(": ")||"Anmeldung fehlgeschlagen");
  return j;
}
async function accessToken(){
  if(!auth)throw new DbxError(401,"nicht verbunden");
  if(auth.access&&auth.expires>Date.now()+60000)return auth.access;
  const j=await tokenRequest({grant_type:"refresh_token",refresh_token:auth.refresh,client_id:KEY()});
  auth.access=j.access_token;auth.expires=Date.now()+(j.expires_in||14400)*1000;await saveAuth();
  return auth.access;
}
async function call(url,opts,retry){
  const tok=await accessToken();opts.headers=Object.assign({},opts.headers,{Authorization:"Bearer "+tok});
  const r=await fetch(url,opts);
  if(r.status===401&&!retry){auth.access=null;return call(url,opts,true)}
  if(r.status===429||r.status>=500){if(!retry){await new Promise(z=>setTimeout(z,1500));return call(url,opts,true)}}
  if(!r.ok){let s="";try{const j=await r.clone().json();s=j.error_summary||""}catch(e){try{s=await r.text()}catch(e2){}}throw new DbxError(r.status,s)}
  return r;
}
async function download(path){
  try{const r=await call(CONTENT+"/2/files/download",{method:"POST",headers:{"Dropbox-API-Arg":headerJson({path})}});
    let meta={};try{meta=JSON.parse(r.headers.get("Dropbox-API-Result")||"{}")}catch(e){}
    if(!meta.rev){const m=await call(API+"/2/files/get_metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path})});meta=await m.json()}
    return {blob:await r.blob(),rev:meta.rev||null};}
  catch(e){if(e.status===409&&/not_found/.test(e.summary))return null;throw e}
}
async function upload(path,body,mode){
  const r=await call(CONTENT+"/2/files/upload",{method:"POST",headers:{"Content-Type":"application/octet-stream",
    "Dropbox-API-Arg":headerJson({path,mode,autorename:false,mute:true,strict_conflict:true})},body});
  return r.json();
}
async function remove(path){
  try{await call(API+"/2/files/delete_v2",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path})})}
  catch(e){if(!(e.status===409&&/not_found/.test(e.summary)))throw e}
}

/* ---------- Zusammenführen ---------- */
const t=s=>s?Date.parse(s)||0:0;
function stamp(c){return t(c.geaendert)||t(c.erstellt)}
function merge(local,localDel,remote,remoteDel){
  const del={...remoteDel};for(const [id,d] of Object.entries(localDel||{}))if(!del[id]||t(d)>t(del[id]))del[id]=d;
  const byId=new Map();
  for(const c of remote)byId.set(c.id,c);
  for(const c of local){const r=byId.get(c.id);if(!r||stamp(c)>stamp(r))byId.set(c.id,c)}
  const out=[];for(const c of byId.values()){if(del[c.id]&&t(del[c.id])>=stamp(c))continue;out.push(c)}
  // Löschliste nach 180 Tagen ausdünnen
  const grenze=Date.now()-180*864e5;for(const id of Object.keys(del))if(t(del[id])<grenze)delete del[id];
  return {karten:out,geloescht:del};
}
function same(a,b){const k=x=>JSON.stringify([...x.karten].sort((p,q)=>p.id<q.id?-1:1))+JSON.stringify(Object.keys(x.geloescht).sort());return k(a)===k(b)}
function photoIds(c){return [c.fotoVorne,c.fotoHinten,c.fotoVorneOriginal,c.fotoHintenOriginal].filter(Boolean)}

/* ---------- Abgleich ---------- */
let running=null,again=false;
/* Liegt im App-Ordner eine Sicherungsdatei "import.json", wird sie einmalig eingespielt und danach gelöscht. */
async function importFromDropbox(){
  const f=await download("/import.json");if(!f)return;
  let obj;try{obj=JSON.parse(await f.blob.text())}catch(e){throw new Error("import.json in der Dropbox ist keine gültige Sicherung.")}
  const r=await Store.importBackup(obj);
  await remove("/import.json");
  listeners.forEach(fn=>{try{fn(status,{importiert:r})}catch(e){}});
}
/* Bewertungsdateien "bewertung-*.json": legt die wöchentliche Claude-Bewertung im App-Ordner ab.
   Inhalt: {app:"Fussball-Collector", art:"bewertung", karten:{<id>:{marktwert, marktwertQuellen, bewertetAm, bewertungHinweis}}} */
async function listRoot(){
  let r=await call(API+"/2/files/list_folder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:""})});
  let j=await r.json(),out=[...j.entries];
  while(j.has_more){r=await call(API+"/2/files/list_folder/continue",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cursor:j.cursor})});j=await r.json();out.push(...j.entries)}
  return out;
}
async function loadValuations(){
  const files=(await listRoot()).filter(e=>e[".tag"]==="file"&&/^bewertung[^/]*\.json$/i.test(e.name)).sort((a,b)=>a.name<b.name?-1:1);
  const out=[];
  for(const f of files){const d=await download(f.path_lower||("/"+f.name));if(!d)continue;
    try{const j=JSON.parse(await d.blob.text());if(j&&j.karten&&typeof j.karten==="object")out.push({path:f.path_lower||("/"+f.name),karten:j.karten})}
    catch(e){console.warn("Bewertungsdatei unlesbar",f.name)}}
  return out;
}
function applyValuations(karten,bewertungen){
  let n=0;const jetzt=new Date().toISOString();
  for(const b of bewertungen)for(const [id,v] of Object.entries(b.karten)){
    const c=karten.find(k=>k.id===id);if(!c||!v||typeof v!=="object")continue;
    if(c.bewertetAm&&v.bewertetAm&&t(v.bewertetAm)<=t(c.bewertetAm)&&!c.bewertungAngefragt)continue;
    if(typeof v.marktwert==="number"&&isFinite(v.marktwert)){c.marktwert=Math.round(v.marktwert*100)/100;c.marktwertQuellen=Array.isArray(v.marktwertQuellen)?v.marktwertQuellen:[]}
    if(v.bewertetAm)c.bewertetAm=v.bewertetAm;
    if(typeof v.bewertungHinweis==="string")c.bewertungHinweis=v.bewertungHinweis;
    c.bewertungAngefragt=false;c.geaendert=jetzt;n++;
  }
  return n;
}
async function syncOnce(){
  await importFromDropbox();
  let bewertungen=[];try{bewertungen=await loadValuations()}catch(e){console.warn(e)}
  for(let versuch=0;versuch<4;versuch++){
    const rem=await download("/karten.json");
    let remote={karten:[],geloescht:{}};
    if(rem){try{const j=JSON.parse(await rem.blob.text());remote={karten:Array.isArray(j.karten)?j.karten:[],geloescht:j.geloescht||{}}}catch(e){throw new Error("karten.json in der Dropbox ist beschädigt.")}}
    const local={karten:await Store.allCards(),geloescht:(await Store.getMeta("geloescht"))||{}};
    const m=merge(local.karten,local.geloescht,remote.karten,remote.geloescht);
    m.karten=m.karten.map(c=>({...c}));
    const bewertet=bewertungen.length?applyValuations(m.karten,bewertungen):0;
    // Fotos zuerst hochladen, damit andere Geräte sie finden, sobald die Karte erscheint
    for(const c of m.karten)for(const id of photoIds(c)){
      const r=await Store.getPhotoRecord(id);if(r&&!r.hochgeladen){
        try{await upload("/fotos/"+id+".jpg",r.blob,"add")}catch(e){if(!(e.status===409&&/conflict/.test(e.summary)))throw e}
        await Store.markUploaded(id)}}
    if(!same(m,remote)||!rem){
      const body=JSON.stringify({app:"Fussball-Collector",format:1,gespeichert:new Date().toISOString(),karten:m.karten,geloescht:m.geloescht});
      try{await upload("/karten.json",new Blob([body],{type:"application/json"}),rem?{".tag":"update",update:rem.rev}:"add")}
      catch(e){if(e.status===409&&/conflict/.test(e.summary))continue;throw e} // jemand anderes war schneller: neu laden und nochmal
    }
    if(!same(m,local)||bewertet)await Store.replaceAll(m.karten,m.geloescht);
    // Eingespielte Bewertungsdateien entfernen
    for(const b of bewertungen){try{await remove(b.path)}catch(e){console.warn(e)}}
    if(bewertet)listeners.forEach(fn=>{try{fn(status,{bewertet})}catch(e){}});
    // Gelöschte Fotos auch in der Dropbox entfernen
    const q=(await Store.getMeta("fotosLoeschen"))||[];
    if(q.length){const still=new Set(m.karten.flatMap(photoIds));const rest=[];
      for(const id of q){if(still.has(id))continue;try{await remove("/fotos/"+id+".jpg")}catch(e){rest.push(id)}}
      await Store.setMeta("fotosLoeschen",rest)}
    return;
  }
  throw new Error("Die Dropbox-Daten ändern sich gerade auf einem anderen Gerät. Bitte gleich nochmal versuchen.");
}
async function sync(){
  if(!auth)return;
  if(running){again=true;return running}
  running=(async()=>{
    do{again=false;setStatus("laeuft","Wird abgeglichen …");
      try{await syncOnce();await Store.setMeta("letzterAbgleich",new Date().toISOString());setStatus("ok","In Dropbox gespeichert")}
      catch(e){console.error(e);
        if(e.status===400&&/invalid_grant/.test(e.message)||e.status===401){setStatus("fehler","Dropbox-Anmeldung abgelaufen. Bitte neu verbinden.")}
        else if(!navigator.onLine||e instanceof TypeError){setStatus("offline","Offline – wird später in Dropbox gespeichert")}
        else setStatus("fehler","Abgleich fehlgeschlagen: "+e.message);
        again=false}
    }while(again);
    running=null;
  })();
  return running;
}
let timer=null;
function schedule(ms){clearTimeout(timer);timer=setTimeout(sync,ms==null?1200:ms)}

/* ---------- Anmeldung ---------- */
async function connect(){
  if(!KEY())throw new Error("Für diese App ist noch kein Dropbox-App-Schlüssel hinterlegt.");
  const verifier=randomString(48),state=randomString(16);
  const pk={verifier,state};try{localStorage.setItem("dbx_pkce",JSON.stringify(pk))}catch(e){}await Store.setMeta("dbx_pkce",pk);
  const p=new URLSearchParams({client_id:KEY(),response_type:"code",code_challenge:b64url(await sha256(verifier)),code_challenge_method:"S256",
    token_access_type:"offline",redirect_uri:redirectUri(),state});
  location.href="https://www.dropbox.com/oauth2/authorize?"+p.toString();
}
/* Ausweichweg ohne Weiterleitung: Dropbox zeigt einen Code an, den man in die App kopiert. */
async function codeUrl(){
  if(!KEY())throw new Error("Für diese App ist noch kein Dropbox-App-Schlüssel hinterlegt.");
  const verifier=randomString(48);await Store.setMeta("dbx_pkce_code",{verifier});
  const p=new URLSearchParams({client_id:KEY(),response_type:"code",code_challenge:b64url(await sha256(verifier)),code_challenge_method:"S256",token_access_type:"offline"});
  return "https://www.dropbox.com/oauth2/authorize?"+p.toString();
}
async function finishWithCode(code){
  const pk=await Store.getMeta("dbx_pkce_code");if(!pk)throw new Error("Bitte zuerst „Code holen“ antippen.");
  await finish(await tokenRequest({grant_type:"authorization_code",code:code.trim(),code_verifier:pk.verifier,client_id:KEY()}));
  await Store.setMeta("dbx_pkce_code",null);
}
async function finish(j){
  auth={refresh:j.refresh_token,access:j.access_token,expires:Date.now()+(j.expires_in||14400)*1000,name:""};
  await saveAuth();
  try{const r=await call(API+"/2/users/get_current_account",{method:"POST"});const a=await r.json();auth.name=(a.name&&a.name.display_name)||a.email||"";await saveAuth()}catch(e){}
}
/* Nach der Rückkehr von Dropbox: Code aus der Adresse gegen Token tauschen. */
async function handleRedirect(){
  const u=new URL(location.href);const code=u.searchParams.get("code"),state=u.searchParams.get("state"),err=u.searchParams.get("error");
  if(!code&&!err)return null;
  history.replaceState(null,"",redirectUri());
  if(err)return "Die Dropbox-Anmeldung wurde abgebrochen.";
  let pk=await Store.getMeta("dbx_pkce");if(!pk){try{pk=JSON.parse(localStorage.getItem("dbx_pkce")||"null")}catch(e){}}
  if(!pk||pk.state!==state)return "Die Dropbox-Anmeldung ist nicht zu Ende gelaufen. Bitte versuche es über „Mit Code anmelden“.";
  try{await finish(await tokenRequest({grant_type:"authorization_code",code,code_verifier:pk.verifier,client_id:KEY(),redirect_uri:redirectUri()}))}
  catch(e){return "Dropbox-Anmeldung fehlgeschlagen: "+e.message}
  await Store.setMeta("dbx_pkce",null);try{localStorage.removeItem("dbx_pkce")}catch(e){}
  return "ok";
}
async function disconnect(){
  if(auth){try{await call(API+"/2/auth/token/revoke",{method:"POST"})}catch(e){}}
  auth=null;await Store.setMeta("dropbox",null);setStatus("aus","");
}

async function init(){
  auth=(await Store.getMeta("dropbox"))||null;
  const r=await handleRedirect();
  Store.fetchMissingPhoto=async id=>{if(!auth)return null;const d=await download("/fotos/"+id+".jpg");return d?d.blob:null};
  Store.onChange(q=>{if(q==="lokal"&&auth)schedule()});
  addEventListener("online",()=>schedule(200));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")schedule(300)});
  setInterval(()=>{if(document.visibilityState==="visible")schedule(0)},120000);
  if(auth)schedule(0);else setStatus("aus","");
  return r;
}

root.Sync={init,connect,codeUrl,finishWithCode,disconnect,sync,
  connected:()=>!!auth,account:()=>auth&&auth.name,configured:()=>!!KEY(),
  status:()=>status,onStatus(f){listeners.add(f)},_merge:merge};
})(window);
