/* Kartenfoto-Bearbeitung: Erkennung, Entzerrung, Tonwerte, Reflexionsminderung, Qualitätsprüfung.
   Eingabe/Ausgabe: {data:Uint8ClampedArray RGBA, width, height}. Keine Abhängigkeiten. */
(function(root){
"use strict";
const CARD=63.5/88.9; // Standard-Sammelkarte kurz/lang

function downscale(img,maxSide){
  const k=Math.min(1,maxSide/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*k)),h=Math.max(1,Math.round(img.height*k));
  const g=new Float32Array(w*h),sx=img.width/w,sy=img.height/h,d=img.data;
  for(let y=0;y<h;y++){const y0=Math.floor(y*sy),y1=Math.max(y0+1,Math.floor((y+1)*sy));
    for(let x=0;x<w;x++){const x0=Math.floor(x*sx),x1=Math.max(x0+1,Math.floor((x+1)*sx));let s=0,n=0;
      for(let yy=y0;yy<y1;yy+=1)for(let xx=x0;xx<x1;xx+=1){const i=(yy*img.width+xx)*4;s+=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];n++}
      g[y*w+x]=s/n}}
  return {g,w,h,k:w/img.width};
}
function blur(g,w,h){ // 5er-Binomial, separabel
  const t=new Float32Array(w*h),o=new Float32Array(w*h),K=[1,4,6,4,1];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let j=-2;j<=2;j++){const xx=x+j;if(xx<0||xx>=w)continue;s+=g[y*w+xx]*K[j+2];n+=K[j+2]}t[y*w+x]=s/n}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0,n=0;for(let j=-2;j<=2;j++){const yy=y+j;if(yy<0||yy>=h)continue;s+=t[yy*w+x]*K[j+2];n+=K[j+2]}o[y*w+x]=s/n}
  return o;
}
function sobel(g,w,h){
  const mag=new Float32Array(w*h),ang=new Float32Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;
    const gx=(g[i-w+1]+2*g[i+1]+g[i+w+1])-(g[i-w-1]+2*g[i-1]+g[i+w-1]);
    const gy=(g[i+w-1]+2*g[i+w]+g[i+w+1])-(g[i-w-1]+2*g[i-w]+g[i-w+1]);
    mag[i]=Math.hypot(gx,gy);ang[i]=Math.atan2(gy,gx);}
  return {mag,ang};
}
function percentile(arr,p,step){const a=[];for(let i=0;i<arr.length;i+=step||1)a.push(arr[i]);a.sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor(p*a.length)))]}

function houghLines(mag,ang,w,h,thr){
  const NT=180,diag=Math.ceil(Math.hypot(w,h)),NR=2*diag+1,acc=new Float32Array(NT*NR);
  const cs=new Float32Array(NT),sn=new Float32Array(NT);for(let t=0;t<NT;t++){cs[t]=Math.cos(t*Math.PI/NT);sn[t]=Math.sin(t*Math.PI/NT)}
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){const i=y*w+x,m=mag[i];if(m<thr)continue;
    let t0=Math.round(((ang[i]%Math.PI)+Math.PI)%Math.PI/Math.PI*NT);const wv=Math.min(m/thr,3);
    for(let dt=-6;dt<=6;dt++){const t=((t0+dt)%NT+NT)%NT;const r=Math.round(x*cs[t]+y*sn[t])+diag;acc[t*NR+r]+=wv}}
  const peaks=[];const used=new Uint8Array(NT*NR);
  for(let n=0;n<48;n++){let best=-1,bv=0;for(let i=0;i<acc.length;i++)if(!used[i]&&acc[i]>bv){bv=acc[i];best=i}
    if(best<0||bv<Math.min(w,h)*0.12)break;const t=Math.floor(best/NR),r=best%NR-diag;peaks.push({t:t*Math.PI/NT,r,v:bv});
    for(let dt=-8;dt<=8;dt++){const tt=t+dt;for(let dr=-Math.round(diag*0.03)-3;dr<=Math.round(diag*0.03)+3;dr++){
      let T=tt,R=r+dr;if(T<0){T+=NT;R=-R}else if(T>=NT){T-=NT;R=-R}const rr=R+diag;if(rr>=0&&rr<NR)used[T*NR+rr]=1}}}
  return peaks;
}
function inter(a,b){const c1=Math.cos(a.t),s1=Math.sin(a.t),c2=Math.cos(b.t),s2=Math.sin(b.t);const d=c1*s2-s1*c2;if(Math.abs(d)<1e-6)return null;
  return {x:(a.r*s2-b.r*s1)/d,y:(c1*b.r-c2*a.r)/d}}
function orderQuad(p){const c={x:(p[0].x+p[1].x+p[2].x+p[3].x)/4,y:(p[0].y+p[1].y+p[2].y+p[3].y)/4};
  const s=p.slice().sort((a,b)=>Math.atan2(a.y-c.y,a.x-c.x)-Math.atan2(b.y-c.y,b.x-c.x)); // ab -180°: TL zuerst
  let k=0,best=1e18;for(let i=0;i<4;i++){const v=s[i].x+s[i].y;if(v<best){best=v;k=i}}return [0,1,2,3].map(i=>s[(k+i)%4]);}
function polyArea(q){let a=0;for(let i=0;i<4;i++){const p=q[i],n=q[(i+1)%4];a+=p.x*n.y-n.x*p.y}return Math.abs(a)/2}
function convex(q){let sg=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];const z=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(z)<1e-9)return false;const s=Math.sign(z);if(!sg)sg=s;else if(s!==sg)return false}return true}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

function sideSupport(a,b,mag,ang,w,h,thr,fac){fac=fac||0.45;
  const L=dist(a,b),n=Math.max(20,Math.round(L/2));const nx=-(b.y-a.y)/L,ny=(b.x-a.x)/L;const nang=Math.atan2(ny,nx);let hit=0,cnt=0;
  for(let i=1;i<n;i++){const t=i/n;const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;cnt++;let ok=false;
    for(let o=-2;o<=2&&!ok;o++){const xx=Math.round(x+nx*o),yy=Math.round(y+ny*o);if(xx<1||yy<1||xx>=w-1||yy>=h-1)continue;const j=yy*w+xx;
      if(mag[j]>=thr*fac){let d=Math.abs(ang[j]-nang)%Math.PI;d=Math.min(d,Math.PI-d);if(d<0.35)ok=true}}
    if(ok)hit++}
  return cnt?hit/cnt:0;
}

function detectQuad(img){
  const S=480,ds=downscale(img,S),{w,h}=ds;const g=blur(blur(ds.g,w,h),w,h);const {mag,ang}=sobel(g,w,h);
  const thr=Math.max(6,percentile(mag,0.80,3));
  const lines=houghLines(mag,ang,w,h,thr);
  const H=[],V=[];lines.forEach(l=>{const deg=l.t*180/Math.PI;(deg>=45&&deg<135?H:V).push(l)});
  const take=a=>a.slice(0,16);const hs=take(H),vs=take(V);const cands=[];
  for(let a=0;a<hs.length;a++)for(let b=a+1;b<hs.length;b++)for(let c=0;c<vs.length;c++)for(let d=c+1;d<vs.length;d++){
    const pts=[inter(hs[a],vs[c]),inter(hs[a],vs[d]),inter(hs[b],vs[c]),inter(hs[b],vs[d])];if(pts.some(p=>!p))continue;
    if(pts.some(p=>p.x<-w*0.04||p.y<-h*0.04||p.x>w*1.04||p.y>h*1.04))continue;
    const q=orderQuad(pts);if(!convex(q))continue;const area=polyArea(q)/(w*h);if(area<0.12)continue;
    const sup=[0,1,2,3].map(i=>sideSupport(q[i],q[(i+1)%4],mag,ang,w,h,thr));const minS=Math.min(...sup),meanS=sup.reduce((s,v)=>s+v,0)/4;
    if(minS<0.4||meanS<0.55)continue;
    const wd=(dist(q[0],q[1])+dist(q[3],q[2]))/2,ht=(dist(q[0],q[3])+dist(q[1],q[2]))/2;const r=Math.min(wd,ht)/Math.max(wd,ht);
    if(r<0.6||r>0.86)continue;
    // Winkel nahe 90° (leichte Perspektive erlaubt)
    let angPen=0;for(let i=0;i<4;i++){const p=q[(i+3)%4],c0=q[i],n=q[(i+1)%4];const v1={x:p.x-c0.x,y:p.y-c0.y},v2={x:n.x-c0.x,y:n.y-c0.y};
      const cosA=(v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y));angPen+=Math.abs(cosA)}
    if(angPen>0.6)continue;
    const score=area+meanS*0.25+minS*0.15-angPen*0.3-Math.abs(r-CARD)*0.6;
    cands.push({score,q,sup,minS,meanS,r,area});
  }
  if(!cands.length)return null;
  cands.sort((a,b)=>b.score-a.score);let best=cands[0];
  // Toploader/Hülle: liegt eine fast gleich große Innenkontur mit Kartenformat darin, nimm diese
  const inside=(o,i)=>i.q.every(p=>{let s=0;for(let k=0;k<4;k++){const a=o.q[k],b=o.q[(k+1)%4];const z=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);if(!s)s=Math.sign(z);else if(Math.sign(z)!==s&&Math.abs(z)>1)return false}return true});
  for(const c of cands){if(c===best)continue;if(c.area>=best.area*0.78&&c.area<best.area*0.985&&Math.abs(c.r-CARD)+0.015<Math.abs(best.r-CARD)&&c.minS>=0.5&&inside(best,c)){best=c;break}}
  // Nach außen nachsuchen: helle Kartenränder (z. B. in Hüllen) sind schwächer als innere Rahmenlinien
  {const q=best.q,c={x:(q[0].x+q[1].x+q[2].x+q[3].x)/4,y:(q[0].y+q[1].y+q[2].y+q[3].y)/4};
   const size=Math.min(dist(q[0],q[1]),dist(q[1],q[2]));const maxOff=Math.round(size*0.075);const lines2=[];
   for(let k=0;k<4;k++){const a=q[k],b=q[(k+1)%4],L=dist(a,b);let nx=-(b.y-a.y)/L,ny=(b.x-a.x)/L;const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
     if((mx-c.x)*nx+(my-c.y)*ny<0){nx=-nx;ny=-ny}let far=0;
     for(let o=2;o<=maxOff;o++){const A={x:a.x+nx*o,y:a.y+ny*o},B={x:b.x+nx*o,y:b.y+ny*o};
       if(A.x<1||A.y<1||B.x<1||B.y<1||A.x>w-2||B.x>w-2||A.y>h-2||B.y>h-2)break;
       if(sideSupport(A,B,mag,ang,w,h,thr,0.18)>=0.62)far=o}
     lines2.push({a:{x:a.x+nx*far,y:a.y+ny*far},b:{x:b.x+nx*far,y:b.y+ny*far},off:far})}
   const li=(p,q2)=>{const x1=p.a.x,y1=p.a.y,x2=p.b.x,y2=p.b.y,x3=q2.a.x,y3=q2.a.y,x4=q2.b.x,y4=q2.b.y;const D=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);if(Math.abs(D)<1e-9)return null;
     const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/D;return {x:x1+t*(x2-x1),y:y1+t*(y2-y1)}};
   const nq=[li(lines2[3],lines2[0]),li(lines2[0],lines2[1]),li(lines2[1],lines2[2]),li(lines2[2],lines2[3])];
   if(nq.every(Boolean)){const wd=(dist(nq[0],nq[1])+dist(nq[3],nq[2]))/2,ht=(dist(nq[0],nq[3])+dist(nq[1],nq[2]))/2,r=Math.min(wd,ht)/Math.max(wd,ht);
     if(r>=0.6&&r<=0.86){best.q=nq;best.r=r;best.expanded=lines2.map(l=>l.off)}}}
  best.cands=cands.length;best.q=best.q.map(p=>({x:p.x/ds.k,y:p.y/ds.k}));best.score=Math.min(1,0.4+best.meanS*0.6);return best;
}

function solveH(src,dst){ // dst->src Homographie (8 Unbekannte)
  const A=[],B=[];for(let i=0;i<4;i++){const {x,y}=dst[i],u=src[i].x,v=src[i].y;
    A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v)}
  const n=8;for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];
    for(let r=0;r<n;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<n;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c]}}
  const s=B.map((b,i)=>b/A[i][i]);return [s[0],s[1],s[2],s[3],s[4],s[5],s[6],s[7],1];
}
function warp(img,quad,W,Hh,margin){
  const mx=W*margin,my=Hh*margin,OW=Math.round(W+2*mx),OH=Math.round(Hh+2*my);
  const dst=[{x:mx,y:my},{x:mx+W,y:my},{x:mx+W,y:my+Hh},{x:mx,y:my+Hh}];const M=solveH(quad,dst);
  const out=new Uint8ClampedArray(OW*OH*4),d=img.data,iw=img.width,ih=img.height;
  for(let y=0;y<OH;y++)for(let x=0;x<OW;x++){const z=M[6]*x+M[7]*y+M[8];let u=(M[0]*x+M[1]*y+M[2])/z,v=(M[3]*x+M[4]*y+M[5])/z;
    u=Math.min(iw-1.001,Math.max(0,u));v=Math.min(ih-1.001,Math.max(0,v));const x0=u|0,y0=v|0,fx=u-x0,fy=v-y0;const o=(y*OW+x)*4;
    const i00=(y0*iw+x0)*4,i10=i00+4,i01=i00+iw*4,i11=i01+4;
    for(let c=0;c<3;c++)out[o+c]=(d[i00+c]*(1-fx)+d[i10+c]*fx)*(1-fy)+(d[i01+c]*(1-fx)+d[i11+c]*fx)*fy;out[o+3]=255}
  return {data:out,width:OW,height:OH,inner:{x:Math.round(mx),y:Math.round(my),w:Math.round(W),h:Math.round(Hh)}};
}

function lapVar(img,box){ // Schärfe: Varianz des Laplace auf ~700px
  const k=Math.min(1,700/Math.max(box.w,box.h)),w=Math.round(box.w*k),h=Math.round(box.h*k),g=new Float32Array(w*h),d=img.data;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=((box.y+Math.floor(y/k))*img.width+box.x+Math.floor(x/k))*4;g[y*w+x]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]}
  let s=0,s2=0,n=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;const l=g[i-1]+g[i+1]+g[i-w]+g[i+w]-4*g[i];s+=l;s2+=l*l;n++}
  const m=s/n;return s2/n-m*m;
}

function tone(img,box){
  const d=img.data,N=img.width*img.height;const Ls=[];let glare=0,cnt=0,sum=0;
  for(let y=box.y;y<box.y+box.h;y+=2)for(let x=box.x;x<box.x+box.w;x+=2){const i=(y*img.width+x)*4;const r=d[i],g=d[i+1],b=d[i+2];
    const L=0.299*r+0.587*g+0.114*b;Ls.push(L);sum+=L;cnt++;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx>=245&&mx-mn<30)glare++}
  Ls.sort((a,b)=>a-b);const lo=Math.min(45,Ls[Math.floor(cnt*0.005)]),hi=Math.max(175,Ls[Math.floor(cnt*0.995)]);
  const meanIn=sum/cnt,glareFrac=glare/cnt;
  // Weißabgleich (halb) über neutrale Mitteltöne
  let sr=0,sg=0,sb=0,nn=0;for(let y=box.y;y<box.y+box.h;y+=3)for(let x=box.x;x<box.x+box.w;x+=3){const i=(y*img.width+x)*4;const r=d[i],g=d[i+1],b=d[i+2];const mx=Math.max(r,g,b),mn=Math.min(r,g,b);const L=(r+g+b)/3;
    if(L>60&&L<230&&mx-mn<40){sr+=r;sg+=g;sb+=b;nn++}}
  let wr=1,wg=1,wb=1;if(nn>200){const m=(sr+sg+sb)/3/nn;wr=1+0.5*(m/(sr/nn)-1);wg=1+0.5*(m/(sg/nn)-1);wb=1+0.5*(m/(sb/nn)-1)}
  // Gamma auf Mittelwert ~0,5
  const meanN=Math.min(0.95,Math.max(0.05,(meanIn-lo)/(hi-lo)));let gam=Math.log(0.5)/Math.log(meanN);gam=Math.min(1.35,Math.max(0.75,gam));
  const LUT=new Float32Array(256);for(let v=0;v<256;v++){let t=Math.min(1,Math.max(0,(v-lo)/(hi-lo)));t=Math.pow(t,gam);
    const knee=0.86;if(t>knee)t=knee+(t-knee)*0.6; // Spitzlichter/Reflexionen zurücknehmen
    LUT[v]=t*255}
  for(let i=0;i<N;i++){const o=i*4;const r=Math.min(255,d[o]*wr),g=Math.min(255,d[o+1]*wg),b=Math.min(255,d[o+2]*wb);
    const L=0.299*r+0.587*g+0.114*b;if(L<0.5){d[o]=d[o+1]=d[o+2]=LUT[0];continue}const f=LUT[Math.round(L)]/L;
    let R=r*f,G=g*f,B=b*f;const m=Math.max(R,G,B);if(m>255){const s=255/m;R*=s;G*=s;B*=s}d[o]=R;d[o+1]=G;d[o+2]=B}
  return {meanIn,glareFrac,lo,hi,gamma:gam};
}
function sharpen(img,amount){ // leichte Unschärfemaske, Details bleiben erhalten
  const {width:w,height:h,data:d}=img,src=new Uint8ClampedArray(d);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++){
    const bl=(src[i+c-4]+src[i+c+4]+src[i+c-w*4]+src[i+c+w*4]+4*src[i+c])/8;d[i+c]=src[i+c]+(src[i+c]-bl)*amount}}
}

function processCard(img,opts){
  opts=opts||{};const issues=[],warnings=[];const det=detectQuad(img);
  let quad,found=!!(det&&det.score>0.35);
  if(found){quad=det.q}else{quad=[{x:0,y:0},{x:img.width-1,y:0},{x:img.width-1,y:img.height-1},{x:0,y:img.height-1}];
    issues.push("Die Kartenränder wurden nicht sicher erkannt. Legen Sie die Karte vollständig ins Bild, am besten auf einen ruhigen, dunklen Untergrund.")}
  let wd=(dist(quad[0],quad[1])+dist(quad[3],quad[2]))/2,ht=(dist(quad[0],quad[3])+dist(quad[1],quad[2]))/2;
  const longPx=Math.max(wd,ht);
  if(found){const r=Math.min(wd,ht)/Math.max(wd,ht);if(Math.abs(r-CARD)<0.06){if(wd<ht)wd=ht*CARD;else ht=wd*CARD}
    if(longPx<550)issues.push("Die Karte ist zu klein im Bild. Gehen Sie näher heran, sodass die Karte das Bild fast ausfüllt.")}
  const maxLong=opts.maxLong||1600,k=Math.min(maxLong/Math.max(wd,ht),1.6);
  const W=Math.round(wd*k),Hh=Math.round(ht*k);
  const out=found?warp(img,quad,W,Hh,0.018):{data:new Uint8ClampedArray(img.data),width:img.width,height:img.height,inner:{x:0,y:0,w:img.width,h:img.height}};
  const sharp=lapVar(out,out.inner);
  const t=tone(out,out.inner);
  if(sharp<(opts.blurThr||40))issues.push("Das Foto ist unscharf. Halten Sie das Handy ruhig und tippen Sie vor der Aufnahme auf die Karte, damit sie scharf gestellt wird.");
  else if(sharp<(opts.blurThr||40)*2.2)warnings.push("Das Foto ist etwas unscharf.");
  if(t.meanIn<55)issues.push("Das Foto ist zu dunkel. Fotografieren Sie bei mehr Licht, möglichst Tageslicht.");
  if(t.meanIn>225)issues.push("Das Foto ist überbelichtet. Vermeiden Sie direktes Licht auf der Karte.");
  if(t.glareFrac>0.05)issues.push("Starke Spiegelung auf der Karte. Kippen Sie die Karte leicht oder ändern Sie die Lichtrichtung, ohne Blitz.");
  else if(t.glareFrac>0.012)warnings.push("Leichte Spiegelung wurde abgeschwächt, ist aber noch sichtbar.");
  sharpen(out,0.45);
  return {image:{data:out.data,width:out.width,height:out.height},found,quad,score:det?det.score:0,issues,warnings,
    metrics:{sharp:Math.round(sharp),glare:+(t.glareFrac*100).toFixed(2),mean:Math.round(t.meanIn),gamma:+t.gamma.toFixed(2),cardPx:Math.round(longPx),ratio:det?+det.r.toFixed(3):null,support:det?det.sup.map(v=>+v.toFixed(2)):null}};
}
root.CardProc={processCard,detectQuad};
})(typeof window!=="undefined"?window:globalThis);

