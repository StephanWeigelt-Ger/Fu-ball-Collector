/* Setlisten (Checklisten): erkennt, zu welchem Set eine Karte gehört, und gleicht die Sammlung mit der Setliste ab.
   Quellen der Setlisten:
     1. setlisten/*.json in der App (von Claude recherchiert, mit der App ausgeliefert)
     2. setliste-*.json im Dropbox-App-Ordner (legt die wöchentliche Claude-Aufgabe für neue Sets an, sync.js übernimmt sie)
   Pro Set-ID gilt die Liste mit dem neuesten "stand".
   Format einer Setliste:
   {app:"Fussball-Collector", art:"setliste", id:"…", name:"…", produkt:"…", teil:"…", saison:"2022/23", stand:"2026-11-19",
    laufend:false, hinweis:"…", quellen:[{titel,url}],
    erkennung:{begriffe:[["tier one","magic skills"]], praefix:["MSR"], nummernfeld:false},
    karten:[{nr:"MSR-CHO", spieler:"Callum Hudson-Odoi", verein:"Bayer 04 Leverkusen", info:"/144"}]} */
(function(root){
"use strict";
let eingebaut={}, dropbox={};

function norm(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ß/g,"ss").replace(/ø/g,"o").replace(/[^a-z0-9]+/g," ").trim()}
/* "2022/2023", "2022/23", "22/23", "2022-23" → "2022-23"; "2024" → "2024" */
function saisonKey(s){s=String(s||"");let m=s.match(/(?:20)?(\d\d)\s*[\/\-–]\s*(?:20)?(\d\d)\b/);
  if(m&&(+m[2]===(+m[1]+1)%100))return "20"+m[1]+"-"+m[2];m=s.match(/\b(19|20)\d\d\b/);return m?m[0]:""}
/* Kartennummer vergleichbar machen: "#013" → "13", "msr-cho" → "MSR-CHO" */
function nrKey(s){return String(s||"").toUpperCase().replace(/^#\s*/,"").replace(/\s+/g,"").split("-").map(p=>/^\d+$/.test(p)?String(+p):p).join("-")}

function valid(s){return s&&typeof s==="object"&&s.art==="setliste"&&typeof s.id==="string"&&s.id&&Array.isArray(s.karten)}
function all(){const out={...eingebaut};for(const [id,s] of Object.entries(dropbox))if(!out[id]||(s.stand||"")>=(out[id].stand||""))out[id]=s;return Object.values(out)}

async function load(){
  try{const r=await fetch("setlisten/index.json",{cache:"no-cache"});const idx=await r.json();
    const files=Array.isArray(idx.setlisten)?idx.setlisten:[];
    await Promise.all(files.map(async f=>{try{const j=await (await fetch("setlisten/"+f,{cache:"no-cache"})).json();if(valid(j))eingebaut[j.id]=j}catch(e){console.warn("Setliste nicht lesbar",f)}}));
  }catch(e){console.warn("Setlisten-Verzeichnis nicht lesbar",e)}
  try{dropbox=(await Store.getMeta("setlisten"))||{}}catch(e){dropbox={}}
}
/* Von sync.js aufgerufen: neue Setlisten aus der Dropbox übernehmen. Gibt die Zahl neuer/aktualisierter Listen zurück. */
async function addFromDropbox(lists){
  let cur=(await Store.getMeta("setlisten"))||{},n=0;
  for(const s of lists){if(!valid(s))continue;const o=cur[s.id];if(o&&(o.stand||"")>(s.stand||""))continue;
    if(o&&JSON.stringify(o)===JSON.stringify(s))continue;cur[s.id]=s;n++}
  if(n){await Store.setMeta("setlisten",cur);dropbox=cur}
  return n;
}

/* Saison der Karte passt zur Saison des Sets? Ohne Angabe: ja. "2026" passt zu "2025-26" und "2026-27". */
function saisonOk(a,b){if(!a||!b||a===b)return true;
  const yrs=k=>k.length===4?[k]:[k.slice(0,4),k.slice(0,2)+k.slice(5)];
  if(a.length===4||b.length===4)return yrs(a).some(y=>yrs(b).includes(y));return false}
/* Gehört die Karte zu diesem Set? */
function cardText(c){return [c.serie,c.setNr,c.notiz].filter(Boolean).join(" ")}
function belongs(c,s){
  const er=s.erkennung||{};const txt=norm(c.serie)+" "+norm(c.setNr);
  if(!saisonOk(saisonKey(c.saison)||saisonKey(c.serie),saisonKey(s.saison)))return false;
  const raw=cardText(c).toUpperCase();
  for(const p of er.praefix||[])if(new RegExp("\\b"+p.replace(/[^A-Z0-9]/gi,"")+"-[A-Z0-9]+","i").test(raw)&&(er.begriffe||[]).some(g=>g.some(w=>txt.includes(norm(w)))))return true;
  return (er.begriffe||[]).some(g=>g.length&&g.every(w=>txt.includes(norm(w))));
}
/* Mögliche Kartennummern aus der Karte lesen (nicht die Auflage "016/144"!) */
function nrCandidates(c,s){
  const out=[];if(c.setNr)out.push(nrKey(c.setNr));
  const t=[c.serie,c.notiz].filter(Boolean).join(" ");
  for(const m of t.matchAll(/\b([A-Z]{1,6}(?:-[A-Z0-9]{1,8})+)\b/g))out.push(nrKey(m[1]));
  for(const m of t.matchAll(/(?:#|nr\.?\s*|no\.?\s*)\s*([A-Z0-9]+(?:-[A-Z0-9]+)*)/gi))out.push(nrKey(m[1]));
  if(s&&(s.erkennung||{}).nummernfeld&&c.nummer&&!/\//.test(c.nummer))out.push(nrKey(c.nummer));
  return [...new Set(out)];
}
function nameMatch(a,b){a=norm(a);b=norm(b);if(!a||!b)return false;if(a===b)return true;
  const ta=a.split(" "),tb=b.split(" ");const la=ta[ta.length-1],lb=tb[tb.length-1];
  return la===lb&&la.length>2&&(ta[0][0]===tb[0][0]);}

/* Abgleich der ganzen Sammlung. Ergebnis: {sets:[{set, eintraege:[{k, karten:[]}], vorhanden, fehlend, ohneNr:[karten]}], ohneSet:[karten]} */
function analyse(cards){
  const lists=all();const res=new Map();const ohneSet=[];
  for(const c of cards){
    const hits=lists.filter(s=>belongs(c,s));
    if(!hits.length){ohneSet.push(c);continue}
    // Bei mehreren Treffern: das Set, in dem die Nummer vorkommt, sonst das mit den meisten Suchbegriffen
    let best=null,bestNr=null;
    for(const s of hits){const nrs=nrCandidates(c,s);const e=s.karten.find(k=>nrs.includes(nrKey(k.nr)));if(e){best=s;bestNr=e;break}}
    if(!best)for(const s of hits){const e=s.karten.find(k=>nameMatch(k.spieler,c.spieler));if(e){best=s;bestNr=e;break}}
    if(!best)best=hits[0];
    if(!res.has(best.id))res.set(best.id,{set:best,map:new Map(),ohneNr:[]});
    const r=res.get(best.id);
    if(bestNr){const key=nrKey(bestNr.nr);if(!r.map.has(key))r.map.set(key,[]);r.map.get(key).push(c)}else r.ohneNr.push(c);
  }
  const sets=[...res.values()].map(r=>{
    const eintraege=r.set.karten.map(k=>({k,karten:r.map.get(nrKey(k.nr))||[]}));
    const vorhanden=eintraege.filter(e=>e.karten.length).length;
    return {set:r.set,eintraege,vorhanden,fehlend:eintraege.length-vorhanden,ohneNr:r.ohneNr};
  }).sort((a,b)=>(a.set.name||"").localeCompare(b.set.name||"","de"));
  return {sets,ohneSet};
}
/* Set und Eintrag für eine einzelne Karte */
function forCard(c,analyseRes){for(const s of analyseRes.sets){const e=s.eintraege.find(x=>x.karten.includes(c));if(e)return {s,e};if(s.ohneNr.includes(c))return {s,e:null}}return null}

root.Sets={load,addFromDropbox,analyse,forCard,all,_norm:norm,_saisonKey:saisonKey,_nrKey:nrKey,_belongs:belongs};
})(window);
