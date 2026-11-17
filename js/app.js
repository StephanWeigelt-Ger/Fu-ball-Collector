/* Fußball-Collector – App-Logik. Daten: siehe store.js (lokal auf dem Gerät). */
const APP_VERSION="1.1.0";
const TYPES=["Rookie","Nummeriert","One-of-One","Autogramm","Patch / Trikot","Parallel / Refractor","Insert","Short Print","Graded"];
const GOLD=new Set(["One-of-One","Autogramm","Patch / Trikot"]);
const $=id=>document.getElementById(id);
const eur=new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"});
const dfmt=new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
let cards=[], editing=null, detailId=null, photo={front:null,back:null}, pending={front:null,back:null};
const SIDE={front:"Front",back:"Back"};

TYPES.forEach(t=>{
  const l=document.createElement("label");const c=document.createElement("input");
  c.type="checkbox";c.value=t;c.id="chk-"+t.replace(/\W+/g,"");l.append(c," "+t);$("checks").append(l);
  const o=document.createElement("option");o.value=t;o.textContent=t;$("fType").append(o);
});
$("ver").textContent=APP_VERSION;

function showMsg(t){$("msg").textContent=t;$("msg").hidden=!t}
function photoImg(id,alt,onerr){const im=new Image();im.alt=alt||"";Store.photoURL(id).then(u=>{if(u)im.src=u;else if(onerr)onerr()}).catch(()=>onerr&&onerr());return im}
function parsePreis(s){if(!s)return null;s=String(s).replace(/[€\s]/g,"");if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");const n=parseFloat(s);return isFinite(n)?Math.round(n*100)/100:null}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function tagsOf(c){const t=[...(c.besonderheiten||[])];if(c.nummer&&!t.includes("Nummeriert"))t.push("Nummeriert");if(/^\s*1\s*\/\s*1\s*$/.test(c.nummer||"")&&!t.includes("One-of-One"))t.push("One-of-One");if(c.grading&&!t.includes("Graded"))t.push("Graded");return t}
function hasValue(c){return typeof c.marktwert==="number"&&isFinite(c.marktwert)}
function fdate(s){try{return s?dfmt.format(new Date(s)):""}catch(e){return ""}}
function signed(n){return (n>0?"+":n<0?"−":"±")+eur.format(Math.abs(n))}
function diffEl(c,tag){if(!hasValue(c)||c.preis==null)return null;const d=c.marktwert-c.preis;return el(tag||"div","mvsub "+(d>0?"pos":d<0?"neg":""),signed(d)+" zum Ankauf")}

function render(){
  const q=$("q").value.trim().toLowerCase(), club=$("fClub").value, typ=$("fType").value, sort=$("sort").value;
  const clubs=[...new Set(cards.map(c=>c.verein).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"));
  const cur=$("fClub").value;$("fClub").length=1;$("clubList").textContent="";
  clubs.forEach(v=>{const o=el("option",null,v);o.value=v;$("fClub").append(o);const d=el("option");d.value=v;$("clubList").append(d)});
  $("fClub").value=clubs.includes(cur)?cur:"";
  const lager=[...new Set(cards.map(c=>c.lagerort).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de",{numeric:true}));
  const curL=$("fLager").value;$("fLager").length=1;$("lagerList").textContent="";
  lager.forEach(v=>{const o=el("option",null,v);o.value=v;$("fLager").append(o);const d=el("option");d.value=v;$("lagerList").append(d)});
  $("fLager").value=lager.includes(curL)?curL:"";
  const lag=$("fLager").value;
  let list=cards.filter(c=>{
    if(club&&c.verein!==club)return false;
    if(lag&&c.lagerort!==lag)return false;
    if(typ&&!tagsOf(c).includes(typ))return false;
    if(q){const h=[c.spieler,c.verein,c.serie,c.saison,c.nummer,c.notiz,c.grading,c.lagerort,...tagsOf(c)].join(" ").toLowerCase();if(!h.includes(q))return false}
    return true});
  const cmp={neu:(a,b)=>(b.erstellt||"").localeCompare(a.erstellt||""),spieler:(a,b)=>(a.spieler||"").localeCompare(b.spieler||"","de"),verein:(a,b)=>(a.verein||"").localeCompare(b.verein||"","de"),wertab:(a,b)=>(hasValue(b)?b.marktwert:-1)-(hasValue(a)?a.marktwert:-1),preisab:(a,b)=>(b.preis??-1)-(a.preis??-1),preisauf:(a,b)=>(a.preis??1e12)-(b.preis??1e12),kaufjahr:(a,b)=>(b.kaufjahr||0)-(a.kaufjahr||0)}[sort];
  list.sort(cmp);

  // Kennzahlen
  const valued=cards.filter(hasValue);
  $("sCount").textContent=cards.length;
  $("sSum").textContent=eur.format(cards.reduce((s,c)=>s+(c.preis||0),0));
  $("sValue").textContent=eur.format(valued.reduce((s,c)=>s+c.marktwert,0));
  $("sValueSub").textContent=cards.length?(valued.length===cards.length?"alle Karten bewertet":valued.length+" von "+cards.length+" Karten bewertet"):"";
  const both=cards.filter(c=>hasValue(c)&&c.preis!=null);const diff=both.reduce((s,c)=>s+c.marktwert-c.preis,0);
  $("sDiff").textContent=both.length?signed(diff):"–";$("sDiff").className=both.length?(diff>0?"pos":diff<0?"neg":""):"";
  $("sNum").textContent=cards.filter(c=>tagsOf(c).includes("Nummeriert")).length;
  $("sOne").textContent=cards.filter(c=>tagsOf(c).includes("One-of-One")).length;

  const tb=$("rows");tb.textContent="";
  list.forEach(c=>{
    const tr=document.createElement("tr");tr.onclick=ev=>{if(!ev.target.closest("button,a"))openDetail(c.id)};
    const t1=el("td");const th=el("button","thumb");th.type="button";th.setAttribute("aria-label","Foto vergrößern: "+c.spieler);
    if(c.fotoVorne){const im=photoImg(c.fotoVorne,c.spieler,()=>{th.textContent="Foto fehlt"});im.loading="lazy";th.append(im);th.onclick=ev=>{ev.stopPropagation();openLight(c)}}else{th.textContent="Kein Foto";th.onclick=ev=>{ev.stopPropagation();openDetail(c.id)}}
    t1.append(th);
    const t2=el("td");t2.append(el("div","player",c.spieler||"—"),el("div","club",c.verein||""));
    const bx=el("div","cellbtns");
    const vb=el("button","btn small","Ansehen");vb.type="button";vb.onclick=ev=>{ev.stopPropagation();openDetail(c.id)};
    const eb=el("button","btn edit","✎ Ändern");eb.type="button";eb.setAttribute("aria-label","Karte ändern: "+c.spieler);eb.onclick=ev=>{ev.stopPropagation();openForm(c)};
    bx.append(vb,eb);t2.append(bx);
    const t3=el("td");t3.append(el("div","set",c.serie||"—"));if(c.saison)t3.append(el("div","club",c.saison));if(c.nummer)t3.append(el("div","serial","# "+c.nummer));if(c.grading)t3.append(el("div","club",c.grading));
    const t4=el("td");const ch=el("div","chips");tagsOf(c).forEach(t=>ch.append(el("span","chip"+(GOLD.has(t)?" gold":""),t)));t4.append(ch);
    const t5=el("td","num",c.preis!=null?eur.format(c.preis):"—");
    const t5b=el("td","num");
    if(hasValue(c)){t5b.append(el("div","mv",eur.format(c.marktwert)));const d=diffEl(c);if(d)t5b.append(d);if(c.bewertetAm)t5b.append(el("div","mvsub","Stand "+fdate(c.bewertetAm)))}
    else t5b.append(el("span","chip wait","Noch nicht bewertet"));
    const t6=el("td","num",c.kaufjahr||"—");
    const t6b=el("td");t6b.append(el("div","set",c.lagerort||"—"));
    const t7=el("td");t7.append(el("div","notes",c.notiz||""));
    tr.append(t1,t2,t3,t4,t5,t5b,t6,t6b,t7);tb.append(tr);
  });
  const em=$("empty");
  if(!cards.length){em.hidden=false;em.innerHTML="<strong>Noch keine Karten erfasst</strong>Mit „+ Karte hinzufügen“ legst du deine erste Karte an. Eine vorhandene Sammlung holst du über „Sichern &amp; Laden“ → „Sicherung einspielen“.";}
  else if(!list.length){em.hidden=false;em.innerHTML="<strong>Keine Treffer</strong>Ändere die Suche oder die Filter.";}
  else em.hidden=true;
  if(detailId&&!$("detailSheet").hidden){const c=cards.find(x=>x.id===detailId);if(c)renderDetail(c);else closeDetail()}
}

/* Kartenansicht */
function openDetail(id){const c=cards.find(x=>x.id===id);if(!c)return;detailId=id;renderDetail(c);$("detailSheet").hidden=false;setTimeout(()=>$("btnDetailBack")?.focus(),50)}
function closeDetail(){$("detailSheet").hidden=true;detailId=null}
function fact(dl,k,v){if(v==null||v==="")return;dl.append(el("dt",null,k));const dd=el("dd");if(v instanceof Node)dd.append(v);else dd.textContent=v;dl.append(dd)}
function renderDetail(c){
  const p=$("detail");const keepScroll=p.scrollTop;p.textContent="";
  const top=el("div","topbar");const back=el("button","btn back","← Zurück zur Übersicht");back.type="button";back.id="btnDetailBack";back.onclick=closeDetail;
  const ed=el("button","btn edit","✎ Ändern");ed.type="button";ed.onclick=()=>openForm(c);top.append(back,ed);p.append(top);
  const h=el("div");const h2=el("h2",null,c.spieler||"—");h2.id="dName";h.append(h2,el("div","club",c.verein||""));p.append(h);
  const ph=el("div","dphotos");
  [["Vorderseite",c.fotoVorne],["Rückseite",c.fotoHinten]].forEach(([lbl,id])=>{const b=el("button");b.type="button";b.setAttribute("aria-label",lbl+" vergrößern");
    if(id){b.append(photoImg(id,c.spieler+" "+lbl,()=>{b.textContent="Foto fehlt"}));b.onclick=()=>openLight(c)}else{b.textContent="Kein Foto ("+lbl+")";b.style.cursor="default"}ph.append(b)});
  p.append(ph);
  if(c.fotoVorneOriginal||c.fotoHintenOriginal){const ob=el("button","btn small","Originalfotos ansehen");ob.type="button";ob.style.alignSelf="flex-start";
    ob.onclick=()=>openLight({spieler:c.spieler+" (Original)",fotoVorne:c.fotoVorneOriginal||c.fotoVorne,fotoHinten:c.fotoHintenOriginal||c.fotoHinten});p.append(ob)}
  // Marktwert
  const vb=el("div","valuebox");vb.append(el("h3",null,"Marktwert"));
  if(hasValue(c)){
    vb.append(el("div","big",eur.format(c.marktwert)));
    const qs=c.marktwertQuellen||[];
    const info=el("div","mvsub");info.textContent=(qs.length?"Durchschnitt aus "+qs.length+" Preisen":"Selbst eingetragen")+(c.bewertetAm?" · Stand "+fdate(c.bewertetAm):"");vb.append(info);
    const d=diffEl(c);if(d)vb.append(d);
    if(c.bewertungHinweis)vb.append(el("div","hint",c.bewertungHinweis));
    if(qs.length){
      const det=el("details");const sm=el("summary",null,"Preisangebote und Quellen anzeigen ("+qs.length+")");sm.style.cursor="pointer";sm.style.fontWeight="600";det.append(sm);
      const box=el("div","srcbox");const t=el("table","src");const thd=el("thead");const hr=el("tr");["Quelle","Art","Karte","Preis",""].forEach((x,i)=>{const th=el("th",i===3?"num":null,x);hr.append(th)});thd.append(hr);t.append(thd);
      const tb=el("tbody");qs.forEach(s=>{const r=el("tr");r.append(el("td",null,s.quelle||""),el("td",null,s.art||""));
        const tt=el("td");tt.append(el("div",null,s.titel||""));if(s.original)tt.append(el("div","mvsub","Originalpreis "+s.original));r.append(tt);
        r.append(el("td","num",typeof s.preis==="number"?eur.format(s.preis):"—"));
        const tl=el("td");if(s.url&&/^https:\/\//.test(s.url)){const a=el("a",null,"Quelle öffnen");a.href=s.url;a.target="_blank";a.rel="noopener";tl.append(a)}r.append(tl);tb.append(r)});
      t.append(tb);box.append(t);det.append(box);vb.append(det);
    }
  }else{
    vb.append(el("div","mvsub","Diese Karte ist noch nicht bewertet. Trage den Marktwert über „✎ Ändern“ ein."));
  }
  p.append(vb);
  // Fakten
  const dl=el("dl","facts");
  fact(dl,"Hersteller / Serie",c.serie);fact(dl,"Jahr / Saison",c.saison);
  if(c.nummer){fact(dl,"Nummerierung",el("span","serial","# "+c.nummer))}
  fact(dl,"Grading",c.grading);
  const tags=tagsOf(c);if(tags.length){const ch=el("div","chips");tags.forEach(t=>ch.append(el("span","chip"+(GOLD.has(t)?" gold":""),t)));fact(dl,"Besonderheiten",ch)}
  fact(dl,"Ankaufspreis",c.preis!=null?eur.format(c.preis):"—");fact(dl,"Kaufjahr",c.kaufjahr?String(c.kaufjahr):"—");
  fact(dl,"Lagerort",c.lagerort||"—");fact(dl,"Hinweise",c.notiz);
  p.append(dl);
  const bot=el("div","actions");const b2=el("button","btn back","← Zurück zur Übersicht");b2.type="button";b2.onclick=closeDetail;bot.append(b2);p.append(bot);
  p.scrollTop=keepScroll;
}
$("detailSheet").addEventListener("click",e=>{if(e.target===$("detailSheet"))closeDetail()});

/* Großansicht */
function openLight(c){
  const lb=$("lightbox");lb.textContent="";
  const b=el("button","btn back","← Zurück");b.type="button";lb.append(b);
  [c.fotoVorne,c.fotoHinten].filter(Boolean).forEach((id,i)=>lb.append(photoImg(id,c.spieler+(i?" Rückseite":" Vorderseite"))));
  lb.hidden=false;lb.onclick=()=>{lb.hidden=true};b.focus();
}

/* Formular */
function setPv(which,url){const pv=$(which==="front"?"pvFront":"pvBack");pv.classList.remove("busy");pv.textContent="";if(url){const im=new Image();im.src=url;im.alt="";pv.append(im)}else pv.textContent="Noch kein Foto"}
function setPvId(which,id){if(!id){setPv(which,"");return}Store.photoURL(id).then(u=>setPv(which,u))}
function money(n){return n!=null&&isFinite(n)?String(n).replace(".",","):""}
function openForm(c){
  editing=c||null;$("formTitle").textContent=c?"Karte ändern":"Karte hinzufügen";$("btnSave").textContent=c?"Änderungen speichern":"Speichern";
  $("iSpieler").value=c?.spieler||"";$("iVerein").value=c?.verein||"";$("iSerie").value=c?.serie||"";$("iSaison").value=c?.saison||"";
  $("iNummer").value=c?.nummer||"";$("iGrading").value=c?.grading||"";$("iPreis").value=money(c?.preis);
  $("iWert").value=hasValue(c||{})?money(c.marktwert):"";$("iWertHinweis").value=c?.bewertungHinweis||"";
  $("iKaufjahr").value=c?.kaufjahr||"";$("iNotiz").value=c?.notiz||"";$("iLager").value=c?.lagerort||"";
  document.querySelectorAll("#checks input").forEach(x=>x.checked=!!c?.besonderheiten?.includes(x.value));
  photo={front:c?.fotoVorne||null,back:c?.fotoHinten||null};pending={front:null,back:null};
  setPvId("front",photo.front);setPvId("back",photo.back);
  ["front","back"].forEach(w=>{$("tools"+SIDE[w]).hidden=true;$("q"+SIDE[w]).hidden=true});
  ["camFront","libFront","camBack","libBack"].forEach(id=>{$(id).value=""});
  $("formErr").hidden=true;$("btnDel").hidden=!c;$("btnDelYes").hidden=true;$("btnDelNo").hidden=true;
  $("formSheet").hidden=false;$("form").scrollTop=0;setTimeout(()=>$("btnClose").focus(),50);
}
function closeForm(){$("formSheet").hidden=true;editing=null}

async function loadBitmap(blob){try{return await createImageBitmap(blob,{imageOrientation:"from-image"})}catch(e){return await createImageBitmap(blob)}}
function canvasToBlob(cv,q){return new Promise((r,j)=>cv.toBlob(b=>b?r(b):j(new Error("toBlob")),"image/jpeg",q||0.9))}
async function shrink(file,max){
  try{const bmp=await loadBitmap(file);max=max||1600;const k=Math.min(1,max/Math.max(bmp.width,bmp.height));
    const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*k);cv.height=Math.round(bmp.height*k);
    cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);return await canvasToBlob(cv,0.88);
  }catch(e){return file}
}
async function rotateBlob(blob){
  const bmp=await loadBitmap(blob);const cv=document.createElement("canvas");cv.width=bmp.height;cv.height=bmp.width;
  const x=cv.getContext("2d");x.translate(cv.width,0);x.rotate(Math.PI/2);x.drawImage(bmp,0,0);return canvasToBlob(cv,0.92);
}
async function editPhoto(file){
  const bmp=await loadBitmap(file);const k=Math.min(1,2000/Math.max(bmp.width,bmp.height));
  const cv=document.createElement("canvas");cv.width=Math.round(bmp.width*k);cv.height=Math.round(bmp.height*k);
  const x=cv.getContext("2d",{willReadFrequently:true});x.drawImage(bmp,0,0,cv.width,cv.height);
  const id=x.getImageData(0,0,cv.width,cv.height);
  const res=CardProc.processCard({data:id.data,width:id.width,height:id.height});
  const oc=document.createElement("canvas");oc.width=res.image.width;oc.height=res.image.height;
  oc.getContext("2d").putImageData(new ImageData(res.image.data,res.image.width,res.image.height),0,0);
  return {blob:await canvasToBlob(oc,0.92),issues:res.issues,warnings:res.warnings,found:res.found};
}
function showSide(w){
  const st=pending[w],S=SIDE[w];if(!st)return;
  const b=st.useOrig?st.orig:st.edited;setPv(w,b?URL.createObjectURL(b):"");
  $("tools"+S).hidden=!st.edited;
  const ob=document.querySelector('[data-side="'+S+'"][data-act="orig"]');ob.textContent=st.useOrig?"Bearbeitet zeigen":"Original zeigen";
  const q=$("q"+S);q.textContent="";q.hidden=false;
  if(st.issues.length&&!st.accepted){q.className="qbox bad";q.append(el("strong",null,"Bitte neu aufnehmen"));
    const ul=el("ul");st.issues.forEach(t=>ul.append(el("li",null,t)));q.append(ul);
    const a=el("div","ptools");const nb=el("label","btn","Neu aufnehmen");nb.htmlFor="cam"+S;const lb=el("label","btn","Anderes Foto wählen");lb.htmlFor="lib"+S;
    const ok=el("button","btn","Trotzdem verwenden");ok.type="button";ok.onclick=()=>{st.accepted=true;showSide(w)};a.append(nb,lb,ok);q.append(a)}
  else if(st.warnings.length||st.issues.length){q.className="qbox warn";const ul=el("ul");[...st.issues,...st.warnings].forEach(t=>ul.append(el("li",null,t)));q.append(ul)}
  else{q.className="qbox ok";q.textContent=st.edited?"✓ Karte erkannt, zugeschnitten, begradigt und Licht korrigiert.":"Foto wird unverändert verwendet."}
}
async function pick(which,file){
  if(!file||!file.type.startsWith("image/"))return;
  const S=SIDE[which];const st={orig:file,edited:null,issues:[],warnings:[],useOrig:false,accepted:false,busy:true};pending[which]=st;
  const pv=$("pv"+S);pv.textContent="Foto wird bearbeitet …";pv.classList.add("busy");$("tools"+S).hidden=true;$("q"+S).hidden=true;
  await new Promise(r=>setTimeout(r,30));
  try{const r=await editPhoto(file);if(pending[which]!==st)return;Object.assign(st,{edited:r.blob,issues:r.issues,warnings:r.warnings})}
  catch(e){if(pending[which]!==st)return;st.useOrig=true;st.warnings=["Das Foto konnte nicht automatisch bearbeitet werden und wird unverändert verwendet."]}
  st.busy=false;showSide(which);
}
document.querySelectorAll(".ptools [data-act]").forEach(b=>b.addEventListener("click",async()=>{
  const w=b.dataset.side==="Front"?"front":"back",st=pending[w];if(!st||st.busy)return;
  if(b.dataset.act==="orig"){st.useOrig=!st.useOrig;showSide(w);return}
  st.busy=true;b.disabled=true;try{if(st.edited)st.edited=await rotateBlob(st.edited);st.orig=await rotateBlob(st.orig)}catch(e){}st.busy=false;b.disabled=false;showSide(w);
}));
[["camFront","front"],["libFront","front"],["camBack","back"],["libBack","back"]].forEach(([id,w])=>$(id).addEventListener("change",e=>{const f=e.target.files[0];e.target.value="";pick(w,f)}));
[["pvFront","front"],["pvBack","back"]].forEach(([id,w])=>{const p=$(id);
  p.addEventListener("dragover",e=>{e.preventDefault()});
  p.addEventListener("drop",e=>{e.preventDefault();pick(w,e.dataTransfer.files[0])})});

function photoIds(c){return [c.fotoVorne,c.fotoHinten,c.fotoVorneOriginal,c.fotoHintenOriginal].filter(Boolean)}
async function dropUnusedPhotos(ids,exceptId){
  for(const id of ids){if(!cards.some(o=>o.id!==exceptId&&photoIds(o).includes(id))){try{await Store.deletePhoto(id)}catch(e){}}}
}

$("form").addEventListener("submit",async e=>{
  e.preventDefault();const err=$("formErr");err.hidden=true;
  const fail=t=>{err.textContent=t;err.hidden=false};
  const spieler=$("iSpieler").value.trim();if(!spieler)return fail("Bitte den Namen des Spielers eintragen.");
  const preisRaw=$("iPreis").value.trim();const preis=parsePreis(preisRaw);
  if(preisRaw&&preis==null)return fail("Der Ankaufspreis ist keine gültige Zahl, z. B. 24,90.");
  const wertRaw=$("iWert").value.trim();const wert=parsePreis(wertRaw);
  if(wertRaw&&wert==null)return fail("Der Marktwert ist keine gültige Zahl, z. B. 30,00.");
  const kj=$("iKaufjahr").value.trim();if(kj&&!/^(19|20)\d\d$/.test(kj))return fail("Bitte das Kaufjahr vierstellig eintragen, z. B. 2026.");
  for(const w of ["front","back"]){const st=pending[w];if(!st)continue;
    if(st.busy)return fail("Das Foto wird noch bearbeitet. Bitte einen Moment warten.");
    if(st.issues.length&&!st.accepted&&!st.useOrig)return fail("Bitte nimm das Foto der "+(w==="front"?"Vorderseite":"Rückseite")+" neu auf oder tippe auf „Trotzdem verwenden“.");}
  const btn=$("btnSave");btn.disabled=true;btn.textContent="Speichert …";
  const before=editing?{...editing}:null;
  try{
    const origIds={};
    for(const w of ["front","back"]){const st=pending[w];if(!st)continue;
      const origSmall=await shrink(st.orig,2000);
      if(st.useOrig||!st.edited){photo[w]=await Store.putPhoto(origSmall);origIds[w]=null}
      else{photo[w]=await Store.putPhoto(st.edited);origIds[w]=await Store.putPhoto(origSmall)}
    }
    const besonderheiten=[...document.querySelectorAll("#checks input:checked")].map(x=>x.value);
    const data={spieler,verein:$("iVerein").value.trim(),serie:$("iSerie").value.trim(),saison:$("iSaison").value.trim(),
      nummer:$("iNummer").value.trim(),grading:$("iGrading").value.trim(),besonderheiten,preis,kaufjahr:kj?Number(kj):null,
      notiz:$("iNotiz").value.trim(),lagerort:$("iLager").value.trim(),fotoVorne:photo.front,fotoHinten:photo.back,
      bewertungHinweis:$("iWertHinweis").value.trim()};
    if("front" in origIds)data.fotoVorneOriginal=origIds.front;if("back" in origIds)data.fotoHintenOriginal=origIds.back;
    const oldWert=before&&hasValue(before)?before.marktwert:null;
    data.marktwert=wert;
    if(wert!==oldWert){data.bewertetAm=wert!=null?new Date().toISOString():null;data.marktwertQuellen=[]}
    if(before){
      await Store.putCard({...before,...data});
      await dropUnusedPhotos(photoIds(before).filter(id=>!photoIds({...before,...data}).includes(id)),null);
    }else{
      await Store.putCard({...data,id:Store.newId(),erstellt:new Date().toISOString()});
    }
    closeForm();
  }catch(ex){
    console.error(ex);
    fail(ex&&ex.name==="QuotaExceededError"?"Der Speicherplatz auf diesem Gerät ist voll.":"Speichern fehlgeschlagen. Bitte noch einmal versuchen.");
  }finally{btn.disabled=false;btn.textContent=editing?"Änderungen speichern":"Speichern"}
});
$("btnDel").onclick=()=>{$("btnDel").hidden=true;$("btnDelYes").hidden=false;$("btnDelNo").hidden=false};
$("btnDelNo").onclick=()=>{$("btnDel").hidden=false;$("btnDelYes").hidden=true;$("btnDelNo").hidden=true};
$("btnDelYes").onclick=async()=>{
  if(!editing)return;const c=editing;
  try{await Store.deleteCard(c.id);await dropUnusedPhotos(photoIds(c),c.id);closeForm();closeDetail()}
  catch(e){$("formErr").textContent="Löschen fehlgeschlagen.";$("formErr").hidden=false}
};
$("btnAdd").onclick=()=>openForm(null);
$("btnClose").onclick=closeForm;
$("formSheet").addEventListener("click",e=>{if(e.target===$("formSheet"))closeForm()});

/* Sichern & Laden */
function menuMsg(t){$("menuMsg").textContent=t;$("menuMsg").hidden=!t}
async function showLastBackup(){const d=await Store.getMeta("letzteSicherung").catch(()=>null);$("lastBackup").textContent=d?"Letzte Sicherung: "+fdate(d):"Noch keine Sicherung erstellt."}
function openMenu(){menuMsg("");showLastBackup();renderCloud();$("menuSheet").hidden=false;setTimeout(()=>$("btnMenuClose").focus(),50)}
function closeMenu(){$("menuSheet").hidden=true}
$("btnMenu").onclick=openMenu;$("btnMenuClose").onclick=closeMenu;
$("menuSheet").addEventListener("click",e=>{if(e.target===$("menuSheet"))closeMenu()});
function saveFile(name,blob){
  const f=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&/iPhone|iPad|iPod/.test(navigator.userAgent)&&navigator.canShare({files:[f]}))
    return navigator.share({files:[f],title:name}).catch(()=>{});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}
$("btnBackup").onclick=async()=>{
  const b=$("btnBackup");b.disabled=true;menuMsg("Sicherung wird erstellt …");
  try{const data=await Store.exportBackup();const day=new Date().toISOString().slice(0,10);
    await saveFile("fussball-collector-sicherung-"+day+".json",new Blob([JSON.stringify(data)],{type:"application/json"}));
    await Store.setMeta("letzteSicherung",new Date().toISOString());showLastBackup();
    menuMsg("Sicherung mit "+data.karten.length+" Karten erstellt.");}
  catch(e){console.error(e);menuMsg("Die Sicherung ist fehlgeschlagen.")}
  finally{b.disabled=false}
};
$("fileImport").addEventListener("change",async e=>{
  const f=e.target.files[0];e.target.value="";if(!f)return;menuMsg("Sicherung wird eingespielt …");
  try{const obj=JSON.parse(await f.text());const r=await Store.importBackup(obj);
    menuMsg("Fertig: "+r.neu+" neue Karte"+(r.neu===1?"":"n")+", "+r.akt+" aktualisiert.");}
  catch(err){console.error(err);menuMsg(err instanceof SyntaxError?"Diese Datei ist keine Fußball-Collector-Sicherung.":err.message||"Einspielen fehlgeschlagen.")}
});
function csvCell(v){v=v==null?"":String(v);return /[";\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function num(n){return typeof n==="number"?n.toFixed(2).replace(".",","):""}
$("btnCsv").onclick=()=>{
  const head=["Spieler","Verein","Hersteller/Serie","Jahr/Saison","Nummerierung","Grading","Besonderheiten","Ankaufspreis EUR","Marktwert EUR","Bewertet am","Kaufjahr","Lagerort","Hinweise"];
  const lines=[head.join(";")].concat(cards.map(c=>[c.spieler,c.verein,c.serie,c.saison,c.nummer,c.grading,tagsOf(c).join(", "),num(c.preis),hasValue(c)?num(c.marktwert):"",fdate(c.bewertetAm),c.kaufjahr,c.lagerort,c.notiz].map(csvCell).join(";")));
  saveFile("fussballkarten.csv",new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv"}));
};

document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("lightbox").hidden)$("lightbox").hidden=true;else if(!$("menuSheet").hidden)closeMenu();else if(!$("formSheet").hidden)closeForm();else if(!$("detailSheet").hidden)closeDetail()}});
["q","fClub","fType","fLager","sort"].forEach(id=>$(id).addEventListener("input",render));

/* Dropbox */
const tfmt=new Intl.DateTimeFormat("de-DE",{hour:"2-digit",minute:"2-digit"});
function renderCloud(){
  const on=Sync.connected(),st=Sync.status(),conf=Sync.configured();
  $("cloudDot").className="dot "+(on?st.state:"");
  $("cloudText").textContent=!on?"Dropbox verbinden":st.state==="ok"?"Dropbox ✓":st.state==="laeuft"?"Speichert …":st.state==="offline"?"Offline":"Dropbox !";
  $("btnCloud").title=on?(st.text+(st.when?" ("+tfmt.format(st.when)+")":"")):"Mit Dropbox verbinden";
  $("dbxOn").hidden=!on;$("dbxOff").hidden=on||!conf;$("dbxNoKey").hidden=conf;
  $("dbxName").textContent=Sync.account()||"deiner Dropbox";
  $("dbxState").textContent=on?st.text+(st.when?" · "+tfmt.format(st.when)+" Uhr":""):"";
  $("connectBox").hidden=on||!conf;
}
async function doConnect(){try{await Sync.connect()}catch(e){showMsg(e.message)}}
$("btnCloud").onclick=openMenu;
$("btnConnect").onclick=doConnect;$("btnConnect2").onclick=doConnect;
$("btnSyncNow").onclick=()=>Sync.sync();
$("btnDisconnect").onclick=async()=>{await Sync.disconnect();renderCloud();menuMsg("Verbindung getrennt. Die Karten bleiben in deiner Dropbox und als Kopie auf diesem Gerät.")};
$("lnkCode").onclick=async e=>{e.preventDefault();const w=window.open("about:blank","_blank");try{const u=await Sync.codeUrl();if(w)w.location.href=u;else location.href=u}catch(err){if(w)w.close();menuMsg(err.message)}};
$("btnCode").onclick=async()=>{const c=$("iCode").value;if(!c.trim())return;menuMsg("Wird angemeldet …");
  try{await Sync.finishWithCode(c);$("iCode").value="";menuMsg("Mit Dropbox verbunden.");renderCloud();Sync.sync()}catch(e){menuMsg("Anmeldung fehlgeschlagen: "+e.message)}};
Sync.onStatus(renderCloud);

async function reload(){try{cards=await Store.allCards()}catch(e){showMsg("Die Sammlung konnte nicht geladen werden. Bitte lade die Seite neu.")}render()}
Store.onChange(reload);

(async()=>{
  if(!window.indexedDB){showMsg("Dieser Browser kann keine Daten speichern. Bitte nutze Safari, Chrome oder Edge und keinen privaten Modus.");render();return}
  await reload();
  try{const r=await Sync.init();if(r==="ok")showMsg("Mit Dropbox verbunden. Deine Karten werden jetzt dort gespeichert.");else if(r)showMsg(r)}catch(e){console.error(e)}
  renderCloud();
  try{if(navigator.storage&&navigator.storage.persist)await navigator.storage.persist()}catch(e){}
  if("serviceWorker" in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
