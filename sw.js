/* Service Worker: macht die App offline nutzbar.
   Bei jeder Änderung an App-Dateien die Versionsnummer erhöhen, damit alle Geräte das Update laden. */
const CACHE="fussball-collector-v1.0.0";
const FILES=["./","index.html","css/app.css","js/cardproc.js","js/store.js","js/app.js","manifest.webmanifest",
  "icons/icon.svg","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin===location.origin){
    // Erst Netz (für Updates), bei fehlender Verbindung aus dem Cache
    e.respondWith(fetch(req).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp))}return r})
      .catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));
  }else if(/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)){
    e.respondWith(caches.match(req).then(r=>r||fetch(req).then(n=>{const cp=n.clone();caches.open(CACHE).then(c=>c.put(req,cp));return n})));
  }
});
