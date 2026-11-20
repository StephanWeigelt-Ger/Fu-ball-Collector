/* Hintergrund-Rechenarbeit für "Mehrere Karten per Foto": Karten finden, entzerren, Licht korrigieren.
   Läuft als Web Worker, damit die App währenddessen bedienbar bleibt. */
importScripts("cardproc.js");
self.onmessage=e=>{
  const m=e.data;
  try{
    const img={data:new Uint8ClampedArray(m.buf),width:m.width,height:m.height};
    const items=CardProc.detectCards(img,{mirror:!!m.mirror});
    self.postMessage({progress:0,total:items.length});
    const out=[],tr=[];
    items.forEach((f,i)=>{
      const r=CardProc.processCard(img,m.opts?Object.assign({quad:f.quad},m.opts):{quad:f.quad});
      out.push({quad:f.quad,refined:f.refined,width:r.image.width,height:r.image.height,buf:r.image.data.buffer,issues:r.issues,warnings:r.warnings});
      tr.push(r.image.data.buffer);
      self.postMessage({progress:i+1,total:items.length});
    });
    self.postMessage({done:true,items:out},tr);
  }catch(err){self.postMessage({error:String(err&&err.message||err)})}
};
