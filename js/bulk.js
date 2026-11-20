/* "Mehrere Karten per Foto": zerlegt ein Foto mit mehreren Karten in einzelne, zugeschnittene Kartenbilder.
   Die eigentliche Bildverarbeitung steckt in cardproc.js (detectCards, processCard) und läuft im Web Worker
   bulkworker.js; ohne Worker-Unterstützung direkt im Hauptprogramm. */
(function(root){
"use strict";
const MAX_SIDE=3200; // größere Fotos werden vorher verkleinert (Speicher auf dem iPhone)
const OPTS={maxLong:1600,minLong:420,smallMsg:"Die Karte ist auf dem Sammelfoto recht klein. Für schärfere Bilder weniger Karten auf einmal fotografieren oder näher herangehen."};

async function bitmap(blob){try{return await createImageBitmap(blob,{imageOrientation:"from-image"})}catch(e){return await createImageBitmap(blob)}}
function toBlob(cv,q){return new Promise((r,j)=>cv.toBlob(b=>b?r(b):j(new Error("toBlob")),"image/jpeg",q||0.9))}
function canvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c}

function runWorker(id,mirror,onProgress){
  return new Promise((resolve,reject)=>{
    let w;try{w=new Worker("js/bulkworker.js")}catch(e){reject(e);return}
    w.onmessage=e=>{const m=e.data;
      if(m.error){w.terminate();reject(new Error(m.error));return}
      if(m.done){w.terminate();resolve(m.items);return}
      if(onProgress)onProgress(m.progress,m.total)};
    w.onerror=e=>{w.terminate();reject(new Error(e.message||"Worker-Fehler"))};
    const buf=id.data.buffer.slice(0);
    w.postMessage({buf,width:id.width,height:id.height,mirror,opts:OPTS},[buf]);
  });
}
function runInline(id,mirror,onProgress){
  const img={data:id.data,width:id.width,height:id.height};
  const found=CardProc.detectCards(img,{mirror});
  return found.map((f,i)=>{const r=CardProc.processCard(img,Object.assign({quad:f.quad},OPTS));if(onProgress)onProgress(i+1,found.length);
    return {quad:f.quad,refined:f.refined,width:r.image.width,height:r.image.height,buf:r.image.data.buffer,issues:r.issues,warnings:r.warnings}});
}

/* Liefert {items:[{quad, edited:Blob, orig:Blob, issues, warnings}], base:Canvas (verkleinertes Gesamtfoto), scale} */
async function process(file,opts){
  opts=opts||{};const onProgress=opts.onProgress;
  const bmp=await bitmap(file);
  const k=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height));
  const src=canvas(Math.round(bmp.width*k),Math.round(bmp.height*k));
  const sx=src.getContext("2d",{willReadFrequently:true});sx.drawImage(bmp,0,0,src.width,src.height);
  if(bmp.close)bmp.close();
  const id=sx.getImageData(0,0,src.width,src.height);
  await new Promise(r=>setTimeout(r,20));
  let raw;
  try{raw=await runWorker(id,!!opts.mirror,onProgress)}
  catch(e){console.warn("Worker nicht verfügbar, rechne direkt",e);await new Promise(r=>setTimeout(r,20));raw=runInline(id,!!opts.mirror,onProgress)}
  const items=[];
  for(const r of raw){
    const c=canvas(r.width,r.height);c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.buf),r.width,r.height),0,0);
    const edited=await toBlob(c,0.92);
    // Original: achsenparalleler Ausschnitt um die Karte, wie fotografiert
    const xs=r.quad.map(p=>p.x),ys=r.quad.map(p=>p.y);const L=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));const m=L*0.04;
    const x0=Math.max(0,Math.min(...xs)-m),y0=Math.max(0,Math.min(...ys)-m),x1=Math.min(src.width,Math.max(...xs)+m),y1=Math.min(src.height,Math.max(...ys)+m);
    const kk=Math.min(1,1600/Math.max(x1-x0,y1-y0));const oc=canvas(Math.max(1,Math.round((x1-x0)*kk)),Math.max(1,Math.round((y1-y0)*kk)));
    oc.getContext("2d").drawImage(src,x0,y0,x1-x0,y1-y0,0,0,oc.width,oc.height);
    const orig=await toBlob(oc,0.88);
    items.push({quad:r.quad,refined:r.refined,edited,orig,issues:r.issues||[],warnings:r.warnings||[]});
  }
  const kb=Math.min(1,1400/Math.max(src.width,src.height));const base=canvas(Math.round(src.width*kb),Math.round(src.height*kb));
  base.getContext("2d").drawImage(src,0,0,base.width,base.height);
  return {items,base,scale:kb,width:src.width,height:src.height};
}

/* Übersicht: Gesamtfoto mit nummerierten Umrissen */
function drawOverview(target,res,state){
  const b=res.base;target.width=b.width;target.height=b.height;const x=target.getContext("2d");x.drawImage(b,0,0);
  const lw=Math.max(2,Math.round(b.width/300)),fs=Math.max(14,Math.round(b.width/28));
  res.items.forEach((it,i)=>{const on=!state||state(i);const q=it.quad.map(p=>({x:p.x*res.scale,y:p.y*res.scale}));
    x.lineWidth=lw;x.strokeStyle=on?"#ffcc00":"rgba(200,200,200,.7)";x.setLineDash(on?[]:[lw*3,lw*2]);x.beginPath();q.forEach((p,j)=>j?x.lineTo(p.x,p.y):x.moveTo(p.x,p.y));x.closePath();x.stroke();
    const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;const r=fs*0.8;
    x.setLineDash([]);x.fillStyle=on?"#1d3a8a":"rgba(80,80,80,.85)";x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.fill();
    x.fillStyle="#fff";x.font="700 "+fs+"px system-ui,sans-serif";x.textAlign="center";x.textBaseline="middle";x.fillText(String(i+1),cx,cy+1)});
}
async function rotate(blob){
  const bmp=await bitmap(blob);const c=canvas(bmp.height,bmp.width);const x=c.getContext("2d");x.translate(c.width,0);x.rotate(Math.PI/2);x.drawImage(bmp,0,0);return toBlob(c,0.92);
}
/* Reihenfolge der Karten neu bestimmen (z. B. gespiegelt für Rückseiten); gibt Indizes zurück */
function order(items,mirror,width){
  const tmp=items.map((it,i)=>({quad:it.quad,i}));return CardProc.readingOrder(tmp,mirror,width).map(t=>t.i);
}
root.Bulk={process,drawOverview,rotate,order};
})(window);
