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


/* ---------- Mehrere Karten auf einem Foto ----------
   Ablauf: Hintergrundfarbe am Bildrand schätzen, alles was sich davon abhebt oder von Kanten
   umschlossen ist als Vordergrund markieren, in zusammenhängende Flächen zerlegen, jede Fläche
   durch das kleinste umschließende Rechteck annähern und dieses mit detectQuad im Ausschnitt verfeinern. */
function downscaleRGB(img,maxSide){
  const k=Math.min(1,maxSide/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*k)),h=Math.max(1,Math.round(img.height*k));
  const R=new Float32Array(w*h),G=new Float32Array(w*h),B=new Float32Array(w*h),sx=img.width/w,sy=img.height/h,d=img.data;
  for(let y=0;y<h;y++){const y0=Math.floor(y*sy),y1=Math.max(y0+1,Math.floor((y+1)*sy));
    for(let x=0;x<w;x++){const x0=Math.floor(x*sx),x1=Math.max(x0+1,Math.floor((x+1)*sx));let r=0,g=0,b=0,n=0;
      for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){const i=(yy*img.width+xx)*4;r+=d[i];g+=d[i+1];b+=d[i+2];n++}
      const o=y*w+x;R[o]=r/n;G[o]=g/n;B[o]=b/n}}
  return {R,G,B,w,h,k:w/img.width};
}
function median(a){const s=Array.from(a).sort((x,y)=>x-y);return s.length?s[s.length>>1]:0}
function morph(m,w,h,r,grow){ // quadratisches Strukturelement, separabel
  const t=new Uint8Array(w*h),o=new Uint8Array(w*h),hit=grow?1:0;
  for(let y=0;y<h;y++){let run=0;const row=y*w;
    for(let x=0;x<w;x++){let v=grow?0:1;for(let j=-r;j<=r;j++){const xx=x+j;const q=(xx<0||xx>=w)?(grow?0:1):m[row+xx];if(q===hit){v=hit;break}}t[row+x]=v}}
  for(let x=0;x<w;x++)for(let y=0;y<h;y++){let v=grow?0:1;for(let j=-r;j<=r;j++){const yy=y+j;const q=(yy<0||yy>=h)?(grow?0:1):t[yy*w+x];if(q===hit){v=hit;break}}o[y*w+x]=v}
  return o;
}
function hull(pts){pts.sort((a,b)=>a.x-b.x||a.y-b.y);const cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);const lo=[],up=[];
  for(const p of pts){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
  for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p)}
  lo.pop();up.pop();return lo.concat(up)}
function minRect(h){ // kleinstes umschließendes Rechteck über die Hüllkanten
  let best=null;for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length];const L=Math.hypot(b.x-a.x,b.y-a.y);if(L<1e-9)continue;
    const ux=(b.x-a.x)/L,uy=(b.y-a.y)/L;let mn1=1e18,mx1=-1e18,mn2=1e18,mx2=-1e18;
    for(const p of h){const s=p.x*ux+p.y*uy,t=-p.x*uy+p.y*ux;if(s<mn1)mn1=s;if(s>mx1)mx1=s;if(t<mn2)mn2=t;if(t>mx2)mx2=t}
    const A=(mx1-mn1)*(mx2-mn2);if(!best||A<best.A)best={A,ux,uy,mn1,mx1,mn2,mx2}}
  if(!best)return null;const {ux,uy,mn1,mx1,mn2,mx2}=best;const P=(s,t)=>({x:s*ux-t*uy,y:s*uy+t*ux});
  return {q:[P(mn1,mn2),P(mx1,mn2),P(mx1,mx2),P(mn1,mx2)],a:mx1-mn1,b:mx2-mn2,area:best.A};
}
function crop(img,x0,y0,x1,y1){x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(img.width,Math.ceil(x1));y1=Math.min(img.height,Math.ceil(y1));
  const w=x1-x0,h=y1-y0,out=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)out.set(img.data.subarray(((y0+y)*img.width+x0)*4,((y0+y)*img.width+x1)*4),y*w*4);
  return {data:out,width:w,height:h,x0,y0}}
function readingOrder(items,mirror,W){
  const c=it=>{const q=it.quad;return {x:(q[0].x+q[1].x+q[2].x+q[3].x)/4,y:(q[0].y+q[1].y+q[2].y+q[3].y)/4}};
  items.forEach(it=>{const p=c(it);it.cx=mirror?W-p.x:p.x;it.cy=p.y;it.sz=Math.min(dist(it.quad[0],it.quad[1]),dist(it.quad[1],it.quad[2]))});
  const s=items.slice().sort((a,b)=>a.cy-b.cy);const rows=[];
  for(const it of s){const r=rows[rows.length-1];if(r&&Math.abs(it.cy-r.cy)<0.5*median(r.items.map(x=>x.sz))){r.items.push(it);r.cy=r.items.reduce((t,x)=>t+x.cy,0)/r.items.length}else rows.push({cy:it.cy,items:[it]})}
  return rows.flatMap(r=>r.items.sort((a,b)=>a.cx-b.cx));
}
function fitSurface(xs,ys,vs,w,h){ // quadratische Fläche v(x,y) per kleinste Quadrate
  const f=(x,y)=>{const u=x/w-0.5,v=y/h-0.5;return [1,u,v,u*u,u*v,v*v]};const n=6;const A=Array.from({length:n},()=>new Float64Array(n)),B=new Float64Array(n);
  for(let i=0;i<xs.length;i++){const r=f(xs[i],ys[i]);for(let p=0;p<n;p++){B[p]+=r[p]*vs[i];for(let q=0;q<n;q++)A[p][q]+=r[p]*r[q]}}
  for(let p=0;p<n;p++)A[p][p]+=1e-6*xs.length;
  for(let c=0;c<n;c++){let m=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r][c])>Math.abs(A[m][c]))m=r;[A[c],A[m]]=[A[m],A[c]];[B[c],B[m]]=[B[m],B[c]];
    for(let r=0;r<n;r++){if(r===c)continue;const k=A[r][c]/A[c][c];for(let q=c;q<n;q++)A[r][q]-=k*A[c][q];B[r]-=k*B[c]}}
  const co=Array.from(B,(v,i)=>v/A[i][i]);return (x,y)=>{const r=f(x,y);let s=0;for(let i=0;i<n;i++)s+=co[i]*r[i];return s};
}
function label(mask,mw,mh,ox,oy,minA){ // zusammenhängende Flächen mit Randpunkten
  const lab=new Int32Array(mw*mh);let n=0;const cs=[];
  for(let i0=0;i0<mw*mh;i0++){if(!mask[i0]||lab[i0])continue;n++;const pts=[],idx=[];const q=[i0];lab[i0]=n;
    while(q.length){const i=q.pop(),x=i%mw,y=(i/mw)|0;idx.push(i);let edge=false;
      const nb=[x>0?i-1:-1,x<mw-1?i+1:-1,y>0?i-mw:-1,y<mh-1?i+mw:-1];
      for(const j of nb){if(j<0){edge=true;continue}if(mask[j]){if(!lab[j]){lab[j]=n;q.push(j)}}else edge=true}
      if(edge)pts.push({x:x+ox+0.5,y:y+oy+0.5})}
    if(idx.length<minA)continue;cs.push({area:idx.length,pts,idx,mw,ox,oy})}
  return cs}
function detectCards(img,opts){
  opts=opts||{};const S=opts.size||640;const ds=downscaleRGB(img,S),{R,G,B,w,h}=ds,N=w*h;
  // Hintergrund: am Rand (3 %) gemessen, als sanft verlaufende Fläche (Lichtverlauf) angenähert
  const bw=Math.max(2,Math.round(Math.min(w,h)*0.03));const xs=[],ys=[],vr=[],vg=[],vb=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(x>=bw&&y>=bw&&x<w-bw&&y<h-bw)continue;if((x+y)%2)continue;const i=y*w+x;xs.push(x);ys.push(y);vr.push(R[i]);vg.push(G[i]);vb.push(B[i])}
  let fr=fitSurface(xs,ys,vr,w,h),fgc=fitSurface(xs,ys,vg,w,h),fb=fitSurface(xs,ys,vb,w,h);
  // Ausreißer am Rand (Karte ragt hinein) verwerfen und neu anpassen
  const res0=xs.map((x,i)=>Math.hypot(vr[i]-fr(x,ys[i]),vg[i]-fgc(x,ys[i]),vb[i]-fb(x,ys[i])));const lim=Math.max(12,median(res0)*3);
  const keep=res0.map(v=>v<lim);const sel=a=>a.filter((_,i)=>keep[i]);
  if(keep.filter(Boolean).length>50){fr=fitSurface(sel(xs),sel(ys),sel(vr),w,h);fgc=fitSurface(sel(xs),sel(ys),sel(vg),w,h);fb=fitSurface(sel(xs),sel(ys),sel(vb),w,h)}
  const BR=new Float32Array(N),BG=new Float32Array(N),BB=new Float32Array(N);
  for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){const r=fr(x,y),g=fgc(x,y),b=fb(x,y);for(let yy=y;yy<Math.min(h,y+4);yy++)for(let xx=x;xx<Math.min(w,x+4);xx++){const i=yy*w+xx;BR[i]=r;BG[i]=g;BB[i]=b}}
  // Abstand zum Hintergrund: Helligkeit (Schatten, Licht) zählt schwächer als Farbe
  const D=new Float32Array(N);
  for(let i=0;i<N;i++){const dr=R[i]-BR[i],dg=G[i]-BG[i],db=B[i]-BB[i];const dl=(dr+dg+db)/3;const cr=dr-dl,cg=dg-dl,cb=db-dl;
    D[i]=Math.sqrt(cr*cr+cg*cg+cb*cb+(dl<0?0.25:0.6)*dl*dl)}
  const bd=[];for(let i=0;i<xs.length;i++)if(keep[i])bd.push(D[ys[i]*w+xs[i]]);const noise=percentile(Float32Array.from(bd),0.9,1)||4;
  const T=Math.max(22,noise*2.5);
  const gray=new Float32Array(N);for(let i=0;i<N;i++)gray[i]=0.299*R[i]+0.587*G[i]+0.114*B[i];
  const gb=blur(gray,w,h);const {mag,ang}=sobel(gb,w,h);
  const bm=[];for(let i=0;i<xs.length;i++)if(keep[i]&&xs[i]>2&&ys[i]>2&&xs[i]<w-3&&ys[i]<h-3)bm.push(mag[ys[i]*w+xs[i]]);
  const eth=Math.max(14,(percentile(Float32Array.from(bm),0.95,1)||4)*2.5);
  const thr=Math.max(6,percentile(mag,0.80,3));
  const bar=new Uint8Array(N);
  for(let i=0;i<N;i++){if(D[i]>T||mag[i]>eth)bar[i]=1}
  const barD=morph(bar,w,h,1,true);
  // Hintergrund von außen fluten; was nicht erreicht wird, ist Vordergrund (Löcher gefüllt)
  const bgm=new Uint8Array(N),st=[];
  const push=i=>{if(!bgm[i]&&!barD[i]){bgm[i]=1;st.push(i)}};
  for(let x=0;x<w;x++){push(x);push((h-1)*w+x)}for(let y=0;y<h;y++){push(y*w);push(y*w+w-1)}
  while(st.length){const i=st.pop(),x=i%w;if(x>0)push(i-1);if(x<w-1)push(i+1);if(i>=w)push(i-w);if(i<N-w)push(i+w)}
  const fgA=new Uint8Array(N);for(let i=0;i<N;i++)fgA[i]=bgm[i]?0:1;
  // Variante B: eingeschlossene Lücken zwischen Karten, die wie Hintergrund aussehen, wieder zum Hintergrund zählen
  const fgB=fgA.slice();let holes=0;
  {const seen=new Uint8Array(N);for(let i0=0;i0<N;i0++){if(bgm[i0]||barD[i0]||seen[i0])continue;const q=[i0],idx=[];seen[i0]=1;let sd=0;
    while(q.length){const i=q.pop(),x=i%w;idx.push(i);sd+=D[i];for(const j of [x>0?i-1:-1,x<w-1?i+1:-1,i>=w?i-w:-1,i<N-w?i+w:-1])if(j>=0&&!seen[j]&&!bgm[j]&&!barD[j]){seen[j]=1;q.push(j)}}
    if(idx.length>N*0.004&&sd/idx.length<T*0.45){holes++;for(const i of idx)fgB[i]=0}}}
  // Variante C: nur nach Farbe fluten (öffnet schmale Spalte, in denen Kanten beider Karten zusammenlaufen)
  const fgC=new Uint8Array(N).fill(1);
  {const lim2=T*0.6;const st2=[];const pc=i=>{if(fgC[i]&&D[i]<lim2){fgC[i]=0;st2.push(i)}};
    for(let x=0;x<w;x++){pc(x);pc((h-1)*w+x)}for(let y=0;y<h;y++){pc(y*w);pc(y*w+w-1)}
    while(st2.length){const i=st2.pop(),x=i%w;if(x>0)pc(i-1);if(x<w-1)pc(i+1);if(i>=w)pc(i-w);if(i<N-w)pc(i+w)}}
  const er=Math.max(2,Math.round(Math.min(w,h)*0.008));
  const minA=N*0.004,maxR=Math.round(Math.min(w,h)*0.06);
  function shape(c,r){const hl=hull(c.pts);if(hl.length<3)return null;const mr2=minRect(hl);if(!mr2)return null;
    const ex=r+0.5;const q=mr2.q;const cx=(q[0].x+q[2].x)/2,cy=(q[0].y+q[2].y)/2;
    const a=mr2.a+2*ex,b=mr2.b+2*ex;const ux=(q[1].x-q[0].x)/mr2.a,uy=(q[1].y-q[0].y)/mr2.a;
    const P=(s,t)=>({x:cx+s*ux-t*uy,y:cy+s*uy+t*ux});
    const fill=(c.area+r*2*(mr2.a+mr2.b))/(a*b);const ratio=Math.min(a,b)/Math.max(a,b);
    return {a,b,P,fill,area:a*b,ratio}}
  // Liegt eine Trennlinie zwischen zwei Karten vor? Kante entlang der Linie
  function sep(P,s0,t0,s1,t1){return sideSupport(P(s0,t0),P(s1,t1),mag,ang,w,h,thr,0.35)}
  function grid(c,m,minSup){const {a,b,P}=c;let best=null;
    for(let kx=1;kx<=6;kx++)for(let ky=1;ky<=6;ky++){const n2=kx*ky;if(n2<2||n2>24)continue;const cw=a/kx,ch=b/ky;const r=Math.min(cw,ch)/Math.max(cw,ch);if(r<0.6||r>0.86)continue;
      if(Math.min(cw,ch)<Math.min(w,h)*0.05)continue;
      let minS=1,sum=0,cnt=0;
      for(let i=1;i<kx;i++){const s0=-a/2+cw*i;const v=sep(P,s0,-b/2+2,s0,b/2-2);minS=Math.min(minS,v);sum+=v;cnt++}
      for(let j=1;j<ky;j++){const t0=-b/2+ch*j;const v=sep(P,-a/2+2,t0,a/2-2,t0);minS=Math.min(minS,v);sum+=v;cnt++}
      if(minS<minSup)continue;
      const score=m?-Math.abs(Math.log(cw*ch/m)):sum/cnt-Math.abs(r-CARD)*2+n2*0.01;
      if(!best||score>best.score)best={kx,ky,score}}
    return best}
  function analyse(fg0){
    const fg=morph(fg0,w,h,er,false); // trennt eng liegende Karten, entfernt Fransen
    const comp=[],dbg=[];let rejected=0;
    // Flächen, die nicht wie eine Karte aussehen, durch stärkeres Abtragen (Erosion) weiter trennen
    function visit(c,r,depth){
      const sh=shape(c,r);if(!sh)return;
      const d0={fill:+sh.fill.toFixed(2),ratio:+sh.ratio.toFixed(2),area:Math.round(sh.area),r};sh.d0=d0;
      const clean=sh.fill>=0.86&&sh.ratio>=0.6&&sh.ratio<=0.86;
      if((!clean||sh.area>N*0.2)&&depth<8&&r<maxR){
        let x0=1e9,y0=1e9,x1=0,y1=0;for(const i of c.idx){const x=i%c.mw+c.ox,y=((i/c.mw)|0)+c.oy;if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y}
        const mw=x1-x0+1,mh=y1-y0+1;const sub=new Uint8Array(mw*mh);for(const i of c.idx){const x=i%c.mw+c.ox-x0,y=((i/c.mw)|0)+c.oy-y0;sub[y*mw+x]=1}
        for(let k=2;r+k<=maxR;k+=2){const e=morph(sub,mw,mh,k,false);const parts=label(e,mw,mh,x0,y0,minA*0.5);
          if(parts.length>=2){parts.forEach(p=>visit(p,r+k,depth+1));return}
          if(!parts.length)break}
      }
      dbg.push(d0);
      if(sh.fill>=0.72)comp.push(sh);else rejected+=sh.area;
    }
    label(fg,w,h,0,0,minA).forEach(c=>visit(c,er,0));
    // Einzelkarten-Größe als Maßstab; größere Flächen in ein Raster kx × ky teilen, dessen Trennlinien als Kanten sichtbar sind
    const singles=comp.filter(c=>c.ratio>=0.6&&c.ratio<=0.86&&c.fill>0.85);
    const m=singles.length>=2?median(singles.map(c=>c.area)):0;const out=[];
    for(const c of comp){const singleOK=c.ratio>=0.6&&c.ratio<=0.86;let best=null;
      if(singleOK&&(!m||c.area<1.6*m)){if(c.area>N*0.2)best=grid(c,m,0.55)}
      else best=grid(c,m,0.5)||(m?grid(c,m,0.25):null);
      if(!best&&singleOK)best={kx:1,ky:1};
      c.d0.grid=best?best.kx+"x"+best.ky:"-";
      if(!best){rejected+=c.area;continue}
      const {a,b,P}=c,cw=a/best.kx,ch=b/best.ky;
      for(let i=0;i<best.kx;i++)for(let j=0;j<best.ky;j++){const s0=-a/2+cw*i,t0=-b/2+ch*j;out.push({q:[P(s0,t0),P(s0+cw,t0),P(s0+cw,t0+ch),P(s0,t0+ch)],area:cw*ch})}
    }
    const mc=out.length?median(out.map(o=>o.area)):1;
    return {out,dbg,score:out.length-rejected/mc};
  }
  let A=analyse(fgA);
  if(holes){const Bv=analyse(fgB);if(Bv.score>A.score)A=Bv}
  {const Cv=analyse(fgC);if(Cv.score>A.score)A=Cv}
  if(opts.debug){opts.debug.cands=A.dbg;opts.debug.mask={w,h,bar:Array.from(barD),fg:Array.from(fgA)}}
  // In Originalgröße, mit detectQuad im Ausschnitt verfeinern
  let res=[];
  for(const o of A.out){
    const q=orderQuad(o.q.map(p=>({x:p.x/ds.k,y:p.y/ds.k})));const area=polyArea(q);
    const xs2=q.map(p=>p.x),ys2=q.map(p=>p.y);const L=Math.max(dist(q[0],q[1]),dist(q[1],q[2]));const mg=L*0.06;
    let quad=q,refined=false;
    try{const cr=crop(img,Math.min(...xs2)-mg,Math.min(...ys2)-mg,Math.max(...xs2)+mg,Math.max(...ys2)+mg);
      const d=detectQuad(cr);
      if(d&&d.score>0.35){const rq=d.q.map(p=>({x:p.x+cr.x0,y:p.y+cr.y0}));const ra=polyArea(rq);
        const c1={x:(q[0].x+q[2].x)/2,y:(q[0].y+q[2].y)/2},c2={x:(rq[0].x+rq[2].x)/2,y:(rq[0].y+rq[2].y)/2};
        if(ra>area*0.8&&ra<area*1.15&&dist(c1,c2)<L*0.06){quad=rq;refined=true}}}
    catch(e){}
    res.push({quad,refined,area:polyArea(quad)});
  }
  // Bruchstücke entfernen: deutlich kleiner als die typische Karte
  if(res.length>=3){const m=median(res.map(r=>r.area));res=res.filter(r=>r.area>m*0.45)}
  // Nur eine Karte, die fast das ganze Bild füllt? Dann wie beim Einzelfoto erkennen
  if(res.length<=2){try{const d=detectQuad(img);if(d&&d.score>0.35&&polyArea(d.q)>img.width*img.height*0.25&&res.every(r=>polyArea(r.quad)<polyArea(d.q)*0.8))res=[{quad:d.q,refined:true}]}catch(e){}}
  return readingOrder(res,!!opts.mirror,img.width).map(r=>({quad:r.quad,refined:r.refined}));
}
function processCard(img,opts){
  opts=opts||{};const issues=[],warnings=[];const det=opts.quad?{q:opts.quad,score:1,r:null,sup:null}:detectQuad(img);
  let quad,found=!!(det&&det.score>0.35);
  if(found){quad=det.q}else{quad=[{x:0,y:0},{x:img.width-1,y:0},{x:img.width-1,y:img.height-1},{x:0,y:img.height-1}];
    issues.push("Die Kartenränder wurden nicht sicher erkannt. Legen Sie die Karte vollständig ins Bild, am besten auf einen ruhigen, dunklen Untergrund.")}
  let wd=(dist(quad[0],quad[1])+dist(quad[3],quad[2]))/2,ht=(dist(quad[0],quad[3])+dist(quad[1],quad[2]))/2;
  const longPx=Math.max(wd,ht);
  if(found){const r=Math.min(wd,ht)/Math.max(wd,ht);if(Math.abs(r-CARD)<0.06){if(wd<ht)wd=ht*CARD;else ht=wd*CARD}
    if(longPx<(opts.minLong||550))issues.push(opts.smallMsg||"Die Karte ist zu klein im Bild. Gehen Sie näher heran, sodass die Karte das Bild fast ausfüllt.")}
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
    metrics:{sharp:Math.round(sharp),glare:+(t.glareFrac*100).toFixed(2),mean:Math.round(t.meanIn),gamma:+t.gamma.toFixed(2),cardPx:Math.round(longPx),ratio:det&&det.r?+det.r.toFixed(3):null,support:det&&det.sup?det.sup.map(v=>+v.toFixed(2)):null}};
}
root.CardProc={processCard,detectQuad,detectCards,readingOrder};
})(typeof window!=="undefined"?window:globalThis);

