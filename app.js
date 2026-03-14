// ═══════════════════════════════════════════════════════
// CUSTODY TRACKER — Gunderson v. Winkels
// Full app: schedule engine, per-child tracking, evidence,
// vault, exchanges, bulk entry, export/import
// ═══════════════════════════════════════════════════════

// ═══ STORAGE LAYER — IndexedDB with localStorage fallback ═══
let useIDB=false,db=null;
const DB_NAME='CustodyTrackerDB',DB_VER=1;
const LS_PREFIX='ct_';

// Try to open IndexedDB
function tryOpenDB(){
  return new Promise(res=>{
    try{
      if(!window.indexedDB){res(false);return}
      const r=indexedDB.open(DB_NAME,DB_VER);
      r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('kv'))d.createObjectStore('kv')};
      r.onsuccess=e=>{db=e.target.result;res(true)};
      r.onerror=()=>res(false);
      r.onblocked=()=>res(false);
      // Timeout fallback - if IDB hangs for 2 seconds, give up
      setTimeout(()=>{if(!db)res(false)},2000);
    }catch(e){res(false)}
  });
}

function storeGet(k){
  if(useIDB&&db){
    return new Promise(res=>{
      try{
        const tx=db.transaction('kv','readonly');const s=tx.objectStore('kv');const r=s.get(k);
        r.onsuccess=()=>res(r.result||null);
        r.onerror=()=>res(lsGet(k));
      }catch(e){res(lsGet(k))}
    });
  }
  return Promise.resolve(lsGet(k));
}

function storeSet(k,v){
  // Always save to localStorage as backup
  lsSet(k,v);
  if(useIDB&&db){
    try{
      const tx=db.transaction('kv','readwrite');const s=tx.objectStore('kv');s.put(v,k);
    }catch(e){}
  }
}

function lsGet(k){try{const v=localStorage.getItem(LS_PREFIX+k);return v?JSON.parse(v):null}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(LS_PREFIX+k,JSON.stringify(v))}catch(e){}}

// State
const SK='days',FK='files',VK='vault',CFK='cfg';
let S={tab:'calendar',cM:new Date().getMonth(),cY:new Date().getFullYear(),sel:null,days:{},ef:'all',efFrom:null,sq:'',modal:null,pf:[],vp:[],vf:'all',bulkOpen:false,bulk:{start:'',end:'',zD:null,zO:null,gD:null,gO:null},bulkMsg:''};
let FS={},vault=[],cfg={summerFirstWeekFather:true,schoolOut2025:'2025-06-05',schoolOut2026:'2026-06-04',laborDay2025:'2025-09-01',laborDay2026:'2026-09-07'};

async function loadAll(){
  try{
    useIDB=await tryOpenDB();
  }catch(e){useIDB=false}
  try{
    const[d,f,v,c]=await Promise.all([storeGet(SK),storeGet(FK),storeGet(VK),storeGet(CFK)]);
    if(d)S.days=d;if(f)FS=f;if(v)vault=v;if(c)Object.assign(cfg,c);
  }catch(e){
    // Last resort: try pure localStorage
    const d=lsGet(SK),f=lsGet(FK),v=lsGet(VK),c=lsGet(CFK);
    if(d)S.days=d;if(f)FS=f;if(v)vault=v;if(c)Object.assign(cfg,c);
  }
}
function svDays(){storeSet(SK,S.days)}
function svFiles(){storeSet(FK,FS)}
function svVault(){storeSet(VK,vault)}
function svCfg(){storeSet(CFK,cfg)}

// ═══ KIDS ═══
const KIDS=['zeke','gus'],KN={gus:'Gus',zeke:'Zeke'};
const KC={gus:{avatar:'#378ADD',bg:'var(--gus-bg)',fg:'var(--gus-fg)'},zeke:{avatar:'#D4537E',bg:'var(--zeke-bg)',fg:'var(--zeke-fg)'}};

// ═══ SCHEDULE ENGINE ═══
const MO=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function dk(y,m,d){return`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function parseDStr(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function fmD(k){const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
function fmS(k){const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
function dowN(k){const[y,m,d]=k.split('-').map(Number);return DN[new Date(y,m-1,d).getDay()]}

function nthDow(y,m,dow,n){let c=0;for(let d=1;d<=31;d++){const dt=new Date(y,m,d);if(dt.getMonth()!==m)break;if(dt.getDay()===dow){c++;if(c===n)return d}}return null}
function getSummerRange(yr){const ok=yr===2025?'schoolOut2025':'schoolOut2026',lk=yr===2025?'laborDay2025':'laborDay2026';let o=parseDStr(cfg[ok]);while(o.getDay()!==5)o.setDate(o.getDate()+1);return{start:o,end:parseDStr(cfg[lk])}}
function isInSummer(dt){for(const yr of[2025,2026]){try{const r=getSummerRange(yr);if(dt>=r.start&&dt<=r.end)return{yes:true,start:r.start}}catch(e){}}return{yes:false}}
function is2ndWknd(y,m,d){
  // Per court order: 2nd weekend = the weekend (Thu-Sun) that falls AFTER the first Sunday of the month
  // Step 1: Find first Sunday of the month
  const firstSun=nthDow(y,m,0,1); // 0=Sunday, 1st occurrence
  if(!firstSun)return{is:false};
  // Step 2: Find first Thursday AFTER that first Sunday
  // That Thursday starts the "2nd weekend"
  let thuDate=firstSun+1; // day after first Sunday
  // Walk forward to find the next Thursday
  while(new Date(y,m,thuDate).getDay()!==4){
    thuDate++;
    if(thuDate>31)return{is:false};
    if(new Date(y,m,thuDate).getMonth()!==m)return{is:false};
  }
  // The 2nd weekend block is thuDate(Thu), thuDate+1(Fri), thuDate+2(Sat), thuDate+3(Sun)
  if(d>=thuDate&&d<=thuDate+3){
    // Make sure the Sun doesn't spill into next month
    if(new Date(y,m,thuDate+3).getMonth()!==m&&d>new Date(y,m+1,0).getDate())return{is:false};
    return{is:true,off:d-thuDate};
  }
  return{is:false};
}

function getSched(dateStr){
  const[y,m,d]=dateStr.split('-').map(Number);const dt=new Date(y,m-1,d),dow=dt.getDay(),mo=m-1;
  const sum=isInSummer(dt);
  if(sum.yes){const diff=Math.floor((dt-sum.start)/864e5),wk=Math.floor(diff/7);const dad=cfg.summerFirstWeekFather?(wk%2===0):(wk%2===1);return dad?{daytime:'dad',overnight:'dad',note:"Summer — Father's week. Exchange 5pm Fri.",ref:'Summer: alternating weeks, exchanges 5:00pm Fridays.'}:{daytime:'mom',overnight:'mom',note:"Summer — Mother's week. Exchange 5pm Fri.",ref:'Summer: alternating weeks, exchanges 5:00pm Fridays.'}}
  const sw=is2ndWknd(y,mo,d);
  if(sw.is){if(sw.off===0)return{daytime:'dad',overnight:'dad',note:'2nd wknd — Father Thu after school → Fri 8am.',ref:'2nd weekend: Father Thu after school until Fri prior to school or 8:00am.'};return{daytime:'mom',overnight:'mom',note:`2nd wknd — ${['','Fri','Sat','Sun'][sw.off]} awarded to Mother.`,ref:'2nd weekend of each month awarded to Mother.'}}
  switch(dow){
    case 4:return{daytime:'dad',overnight:'dad',note:"School yr — Thu overnight at Father's.",ref:'Father: every weekend Thu after school → Sun 7pm.'};
    case 5:return{daytime:'dad',overnight:'dad',note:"School yr — Fri overnight at Father's.",ref:'Father: every weekend Thu after school → Sun 7pm.'};
    case 6:return{daytime:'dad',overnight:'dad',note:"School yr — Sat overnight at Father's.",ref:'Father: every weekend Thu after school → Sun 7pm.'};
    case 0:return{daytime:'dad',overnight:'mom',note:'School yr — Sun. Father until 7pm, returns to Mother.',ref:'Father until Sun 7:00pm or when Mother done with work.'};
    default:return{daytime:'mom',overnight:'mom',note:"School yr — Mother's time.",ref:'All other time awarded to Mother.'}
  }
}
function gd(k){return S.days[k]||{}}
function getEff(k,kid){const day=gd(k),sched=getSched(k),kd=day[kid]||{};if(day.override&&(kd.daytime||kd.overnight!=null))return{daytime:kd.daytime||sched.daytime,overnight:kd.overnight!=null?kd.overnight:sched.overnight};return{daytime:sched.daytime,overnight:sched.overnight}}
// schedOverride stores: {zeke:{daytime,overnight},gus:{daytime,overnight},reason:'swap'|'extra_father'|'extra_mother'|'other',reasonNote:''}
function getSchedEff(k,kid){const day=gd(k),sched=getSched(k),so=day.schedOverride&&day.schedOverride[kid];if(so){const dt=so.daytime||sched.daytime,on=so.overnight!=null?so.overnight:sched.overnight;const swapped=(so.daytime&&so.daytime!==sched.daytime)||(so.overnight!=null&&so.overnight!==sched.overnight);return{daytime:dt,overnight:on,changed:!!swapped}}return{daytime:sched.daytime,overnight:sched.overnight,changed:false}}
function getSchedReason(k){const day=gd(k);if(!day.schedOverride)return{reason:null,reasonNote:''};return{reason:day.schedOverride._reason||null,reasonNote:day.schedOverride._reasonNote||''}}
function hasSchedChange(k){const day=gd(k);if(!day.schedOverride)return false;for(const kid of KIDS){const se=getSchedEff(k,kid);if(se.changed)return true}return false}
function getSchedChangeType(k){const r=getSchedReason(k);return r.reason||'swap'}
function isOv(k){const d=gd(k);if(!d||!d.override)return false;const s=getSched(k);for(const kid of KIDS){const kd=d[kid]||{};if(kd.daytime&&kd.daytime!==s.daytime)return true;if(kd.overnight!=null&&kd.overnight!==s.overnight)return true}return false}
function mCells(y,m){const f=new Date(y,m,1).getDay(),dim=new Date(y,m+1,0).getDate(),pd=new Date(y,m,0).getDate(),c=[];for(let i=f-1;i>=0;i--)c.push({d:pd-i,m:m-1,y:m===0?y-1:y,o:1});for(let i=1;i<=dim;i++)c.push({d:i,m,y,o:0});const r=42-c.length;for(let i=1;i<=r;i++)c.push({d:i,m:m+1,y:m===11?y+1:y,o:1});return c}

// ═══ FILE HELPERS ═══
const FIC={pdf:{i:'&#128196;',l:'PDF',bg:'var(--mom-bg)',fg:'var(--mom-fg)'},jpg:{i:'&#128247;',l:'JPG',bg:'var(--on-bg)',fg:'var(--on-fg)'},jpeg:{i:'&#128247;',l:'JPEG',bg:'var(--on-bg)',fg:'var(--on-fg)'},png:{i:'&#128247;',l:'PNG',bg:'var(--on-bg)',fg:'var(--on-fg)'},gif:{i:'&#128247;',l:'GIF',bg:'var(--on-bg)',fg:'var(--on-fg)'},doc:{i:'&#128462;',l:'DOC',bg:'var(--ev-bg)',fg:'var(--ev-fg)'},docx:{i:'&#128462;',l:'DOCX',bg:'var(--ev-bg)',fg:'var(--ev-fg)'},xls:{i:'&#128202;',l:'XLS',bg:'var(--dad-bg)',fg:'var(--dad-fg)'},xlsx:{i:'&#128202;',l:'XLSX',bg:'var(--dad-bg)',fg:'var(--dad-fg)'},ppt:{i:'&#128218;',l:'PPT',bg:'var(--warn-bg)',fg:'var(--warn-fg)'},pptx:{i:'&#128218;',l:'PPTX',bg:'var(--warn-bg)',fg:'var(--warn-fg)'},csv:{i:'&#128202;',l:'CSV',bg:'var(--dad-bg)',fg:'var(--dad-fg)'},txt:{i:'&#128196;',l:'TXT',bg:'var(--gray-bg)',fg:'var(--gray-fg)'},msg:{i:'&#9993;',l:'MSG',bg:'var(--pink-bg)',fg:'var(--pink-fg)'},eml:{i:'&#9993;',l:'EML',bg:'var(--pink-bg)',fg:'var(--pink-fg)'}};
function ext(n){return(n||'').split('.').pop().toLowerCase()}
function fi(n){const e=ext(n);return FIC[e]||{i:'&#128196;',l:e.toUpperCase()||'FILE',bg:'var(--gray-bg)',fg:'var(--gray-fg)'}}
function isImg(n){return['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext(n))}
function isPDF(n){return ext(n)==='pdf'}
function fz(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}
function rb64(f){return new Promise((r,j)=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.onerror=()=>j();rd.readAsDataURL(f)})}
async function hf(files,t){const arr=t==='vault'?S.vp:S.pf;for(const f of files){if(f.size>15e6){alert(`"${f.name}" >15MB.`);continue}try{const b=await rb64(f);arr.push({id:Date.now().toString(36)+Math.random().toString(36).substr(2,6),name:f.name,size:f.size,type:f.type,base64:b});R()}catch(e){alert(`Failed: "${f.name}"`)}}};

function viewF(fid){const f=FS[fid];if(!f)return;S.modal={type:'file',file:f};R()}
function viewVF(idx){const d=vault[idx];if(!d)return;const f=FS[d.fileId];if(!f)return;S.modal={type:'file',file:f};R()}
function dlf(fid){const f=FS[fid];if(!f)return;const a=document.createElement('a');a.href=f.base64;a.download=f.name;a.click()}
function rp(i){S.pf.splice(i,1);R()}
function rvp(i){S.vp.splice(i,1);R()}

function fromBadge(f){if(!f)return'';const lf=f.toLowerCase();let bg='var(--gray-bg)',fg='var(--gray-fg)';if(lf.includes('kelly')){bg='var(--mom-bg)';fg='var(--mom-fg)'}else if(lf.includes('james')){bg='#FCEBEB';fg='#791F1F'}return`<span style="font-size:9px;padding:1px 6px;border-radius:10px;background:${bg};color:${fg};font-weight:500">${esc(f)}</span>`}
function tl(t){return{text:'Text msg',email:'Email',document:'Document',photo:'Photo',note:'Note'}[t]||t}
function tc2(t){return{text:{bg:'var(--dad-bg)',fg:'var(--dad-fg)'},email:{bg:'var(--ev-bg)',fg:'var(--ev-fg)'},document:{bg:'var(--warn-bg)',fg:'var(--warn-fg)'},photo:{bg:'var(--on-bg)',fg:'var(--on-fg)'},note:{bg:'var(--gray-bg)',fg:'var(--gray-fg)'}}[t]||{bg:'var(--gray-bg)',fg:'var(--gray-fg)'}}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}
const VCAT={'custody-plan':{l:'Custody plan',bg:'var(--on-bg)',fg:'var(--on-fg)'},'court-order':{l:'Court order',bg:'var(--mom-bg)',fg:'var(--mom-fg)'},'attorney':{l:'Attorney',bg:'var(--ev-bg)',fg:'var(--ev-fg)'},'financial':{l:'Financial',bg:'var(--dad-bg)',fg:'var(--dad-fg)'},'medical':{l:'Medical/school',bg:'var(--pink-bg)',fg:'var(--pink-fg)'},'communication':{l:'Communication',bg:'var(--warn-bg)',fg:'var(--warn-fg)'},'other':{l:'Other',bg:'var(--gray-bg)',fg:'var(--gray-fg)'}};

// ═══ STATS ═══
function mSt(){let gD=0,gO=0,zD=0,zO=0,ev=0,nf=0;const dim=new Date(S.cY,S.cM+1,0).getDate();for(let d=1;d<=dim;d++){const k=dk(S.cY,S.cM,d),ge=getEff(k,'gus'),ze=getEff(k,'zeke');if(ge.daytime==='dad')gD++;if(ge.overnight==='dad')gO++;if(ze.daytime==='dad')zD++;if(ze.overnight==='dad')zO++;(gd(k).evidence||[]).forEach(x=>{ev++;nf+=(x.files||[]).length})}return{gD,gO,zD,zO,ev,nf}}
function allEv(){const a=[];Object.keys(S.days).sort().forEach(k=>{(S.days[k].evidence||[]).forEach(e=>a.push({date:k,...e}))});return a.reverse()}
function filtEv(){let l=allEv();if(S.ef!=='all')l=l.filter(e=>e.type===S.ef);if(S.efFrom)l=l.filter(e=>e.from===S.efFrom);if(S.sq){const q=S.sq.toLowerCase();l=l.filter(e=>(e.content||'').toLowerCase().includes(q)||(e.from||'').toLowerCase().includes(q)||(e.date||'').includes(q)||(e.files||[]).some(f=>f.name.toLowerCase().includes(q)))}return l}

// ═══ ACTIONS ═══
function stab(t){S.tab=t;R()}
function nm(d){S.cM+=d;if(S.cM>11){S.cM=0;S.cY++}if(S.cM<0){S.cM=11;S.cY--}S.sel=null;R()}
function sel(k){S.sel=k;S.pf=[];R()}
function goTo(k){const[y,m]=k.split('-').map(Number);S.cY=y;S.cM=m-1;S.sel=k;S.tab='calendar';S.pf=[];R()}
function setK(kid,field,val){const d=gd(S.sel);if(!S.days[S.sel])S.days[S.sel]={};if(!S.days[S.sel][kid])S.days[S.sel][kid]={daytime:null,overnight:null};S.days[S.sel][kid][field]=val;S.days[S.sel].override=true;svDays();R()}
function setSchedK(kid,field,val){if(!S.days[S.sel])S.days[S.sel]={};if(!S.days[S.sel].schedOverride)S.days[S.sel].schedOverride={};if(!S.days[S.sel].schedOverride[kid])S.days[S.sel].schedOverride[kid]={daytime:null,overnight:null};S.days[S.sel].schedOverride[kid][field]=val;svDays();R()}
function setSchedReasonFn(reason,note){if(!S.days[S.sel])S.days[S.sel]={};if(!S.days[S.sel].schedOverride)S.days[S.sel].schedOverride={};S.days[S.sel].schedOverride._reason=reason;S.days[S.sel].schedOverride._reasonNote=note||'';svDays();R()}
function resetSched(){if(S.days[S.sel]){delete S.days[S.sel].schedOverride;svDays();R()}}
function resetDay(){if(S.days[S.sel]){S.days[S.sel].gus={daytime:null,overnight:null};S.days[S.sel].zeke={daytime:null,overnight:null};S.days[S.sel].override=false;svDays();R()}}
function addEv(){
  const type=document.getElementById('ev-type').value,fromSel=document.getElementById('ev-from-sel').value,fromCust=(document.getElementById('ev-from-cust')||{}).value||'',from=fromSel==='_custom'?fromCust.trim():fromSel,child=document.getElementById('ev-child').value,content=document.getElementById('ev-content').value.trim(),time=document.getElementById('ev-time').value,imp=document.getElementById('ev-imp').value;
  if(!content&&S.pf.length===0){alert('Enter content or attach files.');return}if(fromSel==='_custom'&&!fromCust.trim()){alert('Enter name.');return}
  if(!S.days[S.sel])S.days[S.sel]={};if(!S.days[S.sel].evidence)S.days[S.sel].evidence=[];
  const refs=[];S.pf.forEach(f=>{FS[f.id]=f;refs.push({id:f.id,name:f.name,size:f.size,type:f.type})});
  S.days[S.sel].evidence.push({type,from,child,content,time,importance:imp,files:refs,addedAt:new Date().toISOString()});
  svDays();svFiles();S.pf=[];R()
}
function delEv(i){if(!confirm('Remove?'))return;const ev=S.days[S.sel].evidence[i];if(ev.files)ev.files.forEach(f=>{delete FS[f.id]});S.days[S.sel].evidence.splice(i,1);svDays();svFiles();R()}
function addXc(){
  const type=document.getElementById('xc-type').value,child=document.getElementById('xc-child').value,time=document.getElementById('xc-time').value,loc=document.getElementById('xc-loc').value.trim(),notes=document.getElementById('xc-notes').value.trim();
  if(!time&&!loc&&!notes){alert('Fill in details.');return}
  if(!S.days[S.sel])S.days[S.sel]={};if(!S.days[S.sel].exchanges)S.days[S.sel].exchanges=[];
  S.days[S.sel].exchanges.push({type,child,time,location:loc,notes,addedAt:new Date().toISOString()});svDays();R()
}
function delXc(i){if(!confirm('Remove?'))return;S.days[S.sel].exchanges.splice(i,1);svDays();R()}
function saveV(){
  if(!S.vp.length)return;const cat=document.getElementById('v-cat').value,notes=document.getElementById('v-notes').value.trim(),dd=document.getElementById('v-date').value;
  S.vp.forEach(f=>{FS[f.id]=f;vault.push({fileId:f.id,fileName:f.name,fileSize:f.size,title:f.name,category:cat,notes,docDate:dd,addedAt:new Date().toISOString()})});
  svFiles();svVault();S.vp=[];R()
}
function delV(i){if(!confirm('Remove?'))return;const d=vault[i];if(d)delete FS[d.fileId];vault.splice(i,1);svVault();svFiles();R()}
function captureScreen(){document.getElementById('screen-pick').click()}
function applyBulk(){
  const startEl=document.getElementById('bulk-start'),endEl=document.getElementById('bulk-end');
  if(!startEl||!endEl||!startEl.value||!endEl.value){alert('Select dates.');return}
  S.bulk.start=startEl.value;S.bulk.end=endEl.value;
  const start=new Date(startEl.value+'T00:00:00'),end=new Date(endEl.value+'T00:00:00');
  if(end<start){alert('End must be after start.');return}
  if(!S.bulk.zD&&!S.bulk.zO&&!S.bulk.gD&&!S.bulk.gO){alert('Select at least one.');return}
  const diffDays=Math.round((end-start)/864e5)+1;
  if(diffDays>366){alert('Max 366 days.');return}
  if(!confirm(`Apply to ${diffDays} days?`))return;
  const cur=new Date(start);
  while(cur<=end){const k=dk(cur.getFullYear(),cur.getMonth(),cur.getDate());if(!S.days[k])S.days[k]={};if(!S.days[k].zeke)S.days[k].zeke={daytime:null,overnight:null};if(!S.days[k].gus)S.days[k].gus={daytime:null,overnight:null};if(S.bulk.zD)S.days[k].zeke.daytime=S.bulk.zD;if(S.bulk.zO)S.days[k].zeke.overnight=S.bulk.zO;if(S.bulk.gD)S.days[k].gus.daytime=S.bulk.gD;if(S.bulk.gO)S.days[k].gus.overnight=S.bulk.gO;S.days[k].override=true;cur.setDate(cur.getDate()+1)}
  svDays();S.bulkMsg=`Updated ${diffDays} days.`;R();setTimeout(()=>{S.bulkMsg='';R()},3000)
}
function resetBulk(){S.bulk={start:'',end:'',zD:null,zO:null,gD:null,gO:null};R()}

// Export/Import
function xpAll(){const d={version:9,days:S.days,files:FS,vault,cfg,exportDate:new Date().toISOString()};const b=new Blob([JSON.stringify(d)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='custody_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click()}
function xpCSV(){const rows=[['Date','Day','Gus_Day','Gus_ON','Zeke_Day','Zeke_ON','Type','Child','From','Content','Time','Importance','Files']];allEv().forEach(e=>{const ge=getEff(e.date,'gus'),ze=getEff(e.date,'zeke');rows.push([e.date,dowN(e.date),ge.daytime,ge.overnight,ze.daytime,ze.overnight,e.type,e.child||'both',e.from||'','"'+((e.content||'').replace(/"/g,'""'))+'"',e.time||'',e.importance||'',(e.files||[]).map(f=>f.name).join('; ')])});const csv=rows.map(r=>r.join(',')).join('\n');const b=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='custody_evidence_'+new Date().toISOString().slice(0,10)+'.csv';a.click()}
function impAll(){const inp=document.createElement('input');inp.type='file';inp.accept='.json';inp.onchange=async function(e){const file=e.target.files[0];if(!file)return;const text=await file.text();try{const data=JSON.parse(text);if(data.days&&confirm(`Import ${Object.keys(data.days).length} days?`)){Object.keys(data.days).forEach(k=>{if(S.days[k]){S.days[k].evidence=[...(S.days[k].evidence||[]),...(data.days[k].evidence||[])];S.days[k].exchanges=[...(S.days[k].exchanges||[]),...(data.days[k].exchanges||[])]}else S.days[k]=data.days[k]});if(data.files)Object.assign(FS,data.files);if(data.vault)vault.push(...data.vault);if(data.cfg)Object.assign(cfg,data.cfg);svDays();svFiles();svVault();svCfg();R();alert('Done!')}}catch{alert('Invalid.')}};inp.click()}
function resetAll(){if(!confirm('Delete ALL?'))return;if(!confirm('Last chance!'))return;S.days={};FS={};vault.length=0;svDays();svFiles();svVault();R()}

// ═══ RENDER ENGINE ═══
// This is a large render function that builds all tabs. Kept as template literals for performance.

function R(){
  const app=document.getElementById('app'),today=new Date(),tK=dk(today.getFullYear(),today.getMonth(),today.getDate()),s=mSt();
  // Find 2nd weekend Thu: first Thursday after first Sunday
  const firstSun=nthDow(S.cY,S.cM,0,1);
  let secThu=null;
  if(firstSun){let td=firstSun+1;while(td<=31){if(new Date(S.cY,S.cM,td).getMonth()===S.cM&&new Date(S.cY,S.cM,td).getDay()===4){secThu=td;break}td++}}

  // Build tabs HTML
  const TABS=['calendar','evidence','documents','exchanges','summary','settings'];
  const TLAB={calendar:'Calendar',evidence:'Evidence',documents:'Documents',exchanges:'Exchanges',summary:'Summary',settings:'Settings'};
  const tabsHtml=TABS.map(t=>`<button class="tab ${S.tab===t?'active':''}" onclick="stab('${t}')">${TLAB[t]}</button>`).join('');

  let content='';
  if(S.tab==='calendar')content=renderCal(s,tK,secThu);
  else if(S.tab==='evidence')content=renderEvLog();
  else if(S.tab==='documents')content=renderVault();
  else if(S.tab==='exchanges')content=renderXchg();
  else if(S.tab==='summary')content=renderSum();
  else if(S.tab==='settings')content=renderCfg();

  app.innerHTML=`
    <div class="hdr"><div><h1>Custody tracker</h1><div class="sub">Gunderson v. Winkels — Zeke &amp; Gus</div></div>
      <div class="ha no-print"><button class="btn bo bsm" onclick="xpAll()">Export</button><button class="btn bo bsm" onclick="impAll()">Import</button><button class="btn bo bsm" onclick="window.print()">Print</button></div>
    </div>
    <div class="tabs no-print">${tabsHtml}</div>
    ${content}
    ${S.modal?renderModal():''}
    <input type="file" id="file-pick" multiple accept="*/*" style="display:none" onchange="hf(this.files,'evidence');this.value='';" />
    <input type="file" id="camera-pick" accept="image/*" capture="environment" style="display:none" onchange="hf(this.files,'evidence');this.value='';" />
    <input type="file" id="screen-pick" accept="image/*" multiple style="display:none" onchange="hf(this.files,'evidence');this.value='';" />
  `;

  // Wire drag-drop
  document.querySelectorAll('.uz,.vu').forEach(z=>{z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('dragover')});z.addEventListener('dragleave',()=>z.classList.remove('dragover'));z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('dragover');hf(e.dataTransfer.files,z.dataset.target||'evidence')})});
}

// ═══ CALENDAR TAB ═══
function renderCal(s,tK,secThu){
  const pendingHtml=S.pf.length?`<div class="fpl">${S.pf.map((f,i)=>{const inf=fi(f.name);return`<div class="fp" title="${esc(f.name)}">${isImg(f.name)?`<img src="${f.base64}">`:`<div class="fpi">${inf.i}</div>`}<div class="fpb" style="background:${inf.bg};color:${inf.fg}">${inf.l}</div><div class="fpn">${esc(f.name)}</div><button class="fpr" onclick="event.stopPropagation();rp(${i})">&times;</button></div>`}).join('')}</div>`:'';

  function bulkChildCard(name,avatar,dKey,oKey){
    return`<div class="child-section" style="margin-bottom:0"><div class="child-header"><div class="child-avatar" style="background:${avatar}">${name[0]}</div><div class="child-name">${name}</div></div>
    <div style="font-size:10px;color:var(--tx2);margin-bottom:4px">Daytime</div><div class="child-grid" style="margin-bottom:6px">
      <div class="child-btn ${S.bulk[dKey]==='dad'?'sel-dad':''}" onclick="S.bulk.${dKey}=S.bulk.${dKey}==='dad'?null:'dad';R()">&#127968; Father</div>
      <div class="child-btn ${S.bulk[dKey]==='mom'?'sel-mom':''}" onclick="S.bulk.${dKey}=S.bulk.${dKey}==='mom'?null:'mom';R()">&#127968; Mother</div>
    </div><div style="font-size:10px;color:var(--tx2);margin-bottom:4px">Overnight</div><div class="child-grid">
      <div class="child-btn ${S.bulk[oKey]==='dad'?'sel-dad':''}" onclick="S.bulk.${oKey}=S.bulk.${oKey}==='dad'?null:'dad';R()">&#127769; Father</div>
      <div class="child-btn ${S.bulk[oKey]==='mom'?'sel-mom':''}" onclick="S.bulk.${oKey}=S.bulk.${oKey}==='mom'?null:'mom';R()">&#127769; Mother</div>
    </div></div>`;
  }

  return`
    <div class="stats">
      <div class="stat"><div class="stat-label">Gus — Father day</div><div class="stat-val" style="color:var(--gus)">${s.gD}</div></div>
      <div class="stat"><div class="stat-label">Gus — Father ON</div><div class="stat-val" style="color:var(--on)">${s.gO}</div></div>
      <div class="stat"><div class="stat-label">Zeke — Father day</div><div class="stat-val" style="color:var(--zeke)">${s.zD}</div></div>
      <div class="stat"><div class="stat-label">Zeke — Father ON</div><div class="stat-val" style="color:var(--on)">${s.zO}</div></div>
      <div class="stat"><div class="stat-label">Evidence</div><div class="stat-val" style="color:var(--ev)">${s.ev}</div></div>
    </div>
    ${secThu?`<div style="font-size:11px;color:var(--warn-fg);background:var(--warn-bg);padding:6px 12px;border-radius:6px;margin-bottom:12px">&#9888; <b>2nd weekend (Thu ${MO[S.cM].substr(0,3)} ${secThu}–Sun ${secThu+3}):</b> Mother's weekend. Father gets Thu overnight only (→ Fri 8am). <span style="font-size:10px;color:var(--tx3)">[1st Sun after ${MO[S.cM].substr(0,3)} ${firstSun}]</span></div>`:''}
    <div class="legend"><span><span class="ld" style="background:var(--gus)"></span>Gus w/ Father</span><span><span class="ld" style="background:var(--zeke)"></span>Zeke w/ Father</span><span><span class="ld" style="background:var(--mom)"></span>w/ Mother</span><span><span class="ld" style="background:var(--warn)"></span>Override</span><span><span class="ld" style="background:var(--pink)"></span>Swap</span></div>
    <div class="panel no-print"><div style="display:flex;justify-content:space-between;cursor:pointer" onclick="S.bulkOpen=!S.bulkOpen;R()"><h3 style="margin-bottom:0">Bulk entry — date range</h3><span style="font-size:18px;color:var(--tx3)">${S.bulkOpen?'&#9650;':'&#9660;'}</span></div>
    ${S.bulkOpen?`<div style="margin-top:12px"><div class="fg"><div class="fr"><label>Start</label><input type="date" id="bulk-start" value="${S.bulk.start}" /></div><div class="fr"><label>End</label><input type="date" id="bulk-end" value="${S.bulk.end}" /></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">${bulkChildCard('Zeke','#D4537E','zD','zO')}${bulkChildCard('Gus','#378ADD','gD','gO')}</div>
    <div style="font-size:11px;color:var(--tx3);margin-top:8px">Only highlighted fields apply.</div>
    <div class="ar" style="margin-top:6px"><button class="btn bp" onclick="applyBulk()">Apply</button><button class="btn bo" onclick="resetBulk()">Clear</button></div>
    ${S.bulkMsg?`<div style="margin-top:8px;font-size:12px;color:var(--dad);font-weight:500">${S.bulkMsg}</div>`:''}</div>`:''}</div>
    <div class="cal-c"><div class="cn"><button onclick="nm(-1)">&larr; ${MO[(S.cM+11)%12].substr(0,3)}</button><span class="mt">${MO[S.cM]} ${S.cY}</span><button onclick="nm(1)">${MO[(S.cM+1)%12].substr(0,3)} &rarr;</button></div>
    <div class="cg">${DN.map(d=>`<div class="dh">${d}</div>`).join('')}${mCells(S.cY,S.cM).map(c=>{
      const k=dk(c.y,c.m,c.d),ge=getEff(k,'gus'),ze=getEff(k,'zeke'),day=gd(k),ov=isOv(k);
      let cls='dc';if(c.o)cls+=' om';if(k===tK)cls+=' today';if(k===S.sel)cls+=' sel';
      const gBar=ge.daytime==='dad'&&ge.overnight==='dad'?'sb-dad':ge.daytime==='dad'?'sb-sp':'sb-mom';
      const zBar=ze.daytime==='dad'&&ze.overnight==='dad'?'sb-dad':ze.daytime==='dad'?'sb-sp':'sb-mom';
      let tags='';const gSame=ge.daytime===ze.daytime&&ge.overnight===ze.overnight;
      if(gSame){if(ge.daytime==='dad'&&ge.overnight==='dad')tags+='<span class="tg tg-g-dad">Both D+ON</span>';else if(ge.daytime==='dad')tags+='<span class="tg tg-g-dad">Both Day</span>';else tags+='<span class="tg tg-g-mom">Both Mom</span>'}
      else{const gc=ge.daytime==='dad'||ge.overnight==='dad'?'tg-g-dad':'tg-g-mom';const zc=ze.daytime==='dad'||ze.overnight==='dad'?'tg-z-dad':'tg-z-mom';tags+=`<span class="tg ${gc}">G:${ge.daytime==='dad'?'D':''}${ge.overnight==='dad'?'ON':''}</span><span class="tg ${zc}">Z:${ze.daytime==='dad'?'D':''}${ze.overnight==='dad'?'ON':''}</span>`}
      if(ov)tags+='<span class="tg tg-fi">!</span>';
      const sc=hasSchedChange(k);if(sc){const sct=getSchedChangeType(k);tags+=sct==='swap'?'<span class="tg tg-xc">SW</span>':sct==='extra_father'?'<span class="tg tg-g-dad">+F</span>':sct==='extra_mother'?'<span class="tg tg-g-mom">+M</span>':'<span class="tg tg-fi">SC</span>'}
      if(day.evidence&&day.evidence.length)tags+=`<span class="tg tg-ev">${day.evidence.length}</span>`;
      return`<div class="${cls}" onclick="sel('${k}')"><div class="sbar-wrap"><div class="sbar-child ${gBar}" title="Gus"></div><div class="sbar-child ${zBar}" title="Zeke"></div></div><div class="dn">${c.d}</div><div class="dtags">${tags}</div></div>`;
    }).join('')}</div></div>
    ${S.sel?renderDay(pendingHtml):'<div class="panel"><div class="es">Select a date</div></div>'}`;
}

function renderDay(ph){
  const k=S.sel,day=gd(k),sched=getSched(k),ov=isOv(k),ev=day.evidence||[],xc=day.exchanges||[];
  const schedChanged=hasSchedChange(k);
  const schedR=getSchedReason(k);
  const REASONS={swap:{label:'Agreed swap / trade day',icon:'&#128260;',desc:'Both parents agreed to trade this day.',bg:'var(--on-bg)',fg:'var(--on-fg)'},extra_father:{label:'Father has extra time',icon:'&#128170;',desc:'Father has kids outside court order (not a swap).',bg:'var(--dad-bg)',fg:'var(--dad-fg)'},extra_mother:{label:'Mother has extra time',icon:'&#127968;',desc:'Mother has kids during Father\'s scheduled time.',bg:'var(--mom-bg)',fg:'var(--mom-fg)'},refused:{label:'Ex refused exchange',icon:'&#128683;',desc:'Scheduled parent was denied custody exchange.',bg:'#FCEBEB',fg:'#791F1F'},other:{label:'Other',icon:'&#128221;',desc:'Other schedule deviation.',bg:'var(--warn-bg)',fg:'var(--warn-fg)'}};

  function schedChildRow(kid){
    const se=getSchedEff(k,kid),kc=KC[kid],name=KN[kid];
    return`<div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><div style="width:20px;height:20px;border-radius:50%;background:${kc.avatar};display:flex;align-items:center;justify-content:center;font-weight:500;font-size:10px;color:#fff">${name[0]}</div><span style="font-weight:500;font-size:12px">${name}</span>${se.changed?`<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:${schedR.reason&&REASONS[schedR.reason]?REASONS[schedR.reason].bg:'var(--pink-bg)'};color:${schedR.reason&&REASONS[schedR.reason]?REASONS[schedR.reason].fg:'var(--pink-fg)'};font-weight:500">${schedR.reason&&REASONS[schedR.reason]?REASONS[schedR.reason].label:'CHANGED'}</span>`:''}</div>
      <div style="font-size:10px;color:var(--tx2);margin-bottom:3px">Daytime</div>
      <div class="child-grid" style="margin-bottom:6px">
        <div class="child-btn ${se.daytime==='dad'?'sel-dad':''}" onclick="setSchedK('${kid}','daytime','dad')" style="font-size:11px;padding:6px">Father</div>
        <div class="child-btn ${se.daytime==='mom'?'sel-mom':''}" onclick="setSchedK('${kid}','daytime','mom')" style="font-size:11px;padding:6px">Mother</div>
      </div>
      <div style="font-size:10px;color:var(--tx2);margin-bottom:3px">Overnight</div>
      <div class="child-grid">
        <div class="child-btn ${se.overnight==='dad'?'sel-dad':''}" onclick="setSchedK('${kid}','overnight','dad')" style="font-size:11px;padding:6px">Father</div>
        <div class="child-btn ${se.overnight==='mom'?'sel-mom':''}" onclick="setSchedK('${kid}','overnight','mom')" style="font-size:11px;padding:6px">Mother</div>
      </div>
    </div>`;
  }

  function actualChildRow(kid){
    const e=getEff(k,kid),kc=KC[kid],name=KN[kid];
    return`<div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><div style="width:20px;height:20px;border-radius:50%;background:${kc.avatar};display:flex;align-items:center;justify-content:center;font-weight:500;font-size:10px;color:#fff">${name[0]}</div><span style="font-weight:500;font-size:12px">${name}</span></div>
      <div style="font-size:10px;color:var(--tx2);margin-bottom:3px">Daytime</div>
      <div class="child-grid" style="margin-bottom:6px">
        <div class="child-btn ${e.daytime==='dad'?'sel-dad':''}" onclick="setK('${kid}','daytime','dad')" style="font-size:11px;padding:6px">Father</div>
        <div class="child-btn ${e.daytime==='mom'?'sel-mom':''}" onclick="setK('${kid}','daytime','mom')" style="font-size:11px;padding:6px">Mother</div>
      </div>
      <div style="font-size:10px;color:var(--tx2);margin-bottom:3px">Overnight</div>
      <div class="child-grid">
        <div class="child-btn ${e.overnight==='dad'?'sel-dad':''}" onclick="setK('${kid}','overnight','dad')" style="font-size:11px;padding:6px">Father</div>
        <div class="child-btn ${e.overnight==='mom'?'sel-mom':''}" onclick="setK('${kid}','overnight','mom')" style="font-size:11px;padding:6px">Mother</div>
      </div>
    </div>`;
  }

  let mismatch=false;
  for(const kid of KIDS){const se=getSchedEff(k,kid),ae=getEff(k,kid);if(se.daytime!==ae.daytime||se.overnight!==ae.overnight)mismatch=true}

  const dayBg=sched.daytime==='dad'?'var(--dad-bg)':'var(--mom-bg)',dayFg=sched.daytime==='dad'?'var(--dad-fg)':'var(--mom-fg)',dayWho=sched.daytime==='dad'?'Father':'Mother';
  const nBg=sched.overnight==='dad'?'var(--on-bg)':'var(--mom-bg)',nFg=sched.overnight==='dad'?'var(--on-fg)':'var(--mom-fg)',nWho=sched.overnight==='dad'?'Father':'Mother';

  const curReason=schedR.reason||'swap';
  const reasonBanner=schedChanged&&REASONS[curReason]?`<div class="swap-banner" style="background:${REASONS[curReason].bg};color:${REASONS[curReason].fg};border:.5px solid currentColor">${REASONS[curReason].icon} ${REASONS[curReason].desc}</div>`:'';

  return`<div class="panel"><h3>${fmD(k)}</h3>
    <div class="sn"><b>Court order:</b> ${esc(sched.note)}<br><b>Default:</b> <span class="sp" style="background:${dayBg};color:${dayFg}">${dayWho} day</span> <span class="sp" style="background:${nBg};color:${nFg}">${nWho} night</span></div>
    <div class="co-ref">"${esc(sched.ref)}"</div>

    ${reasonBanner}
    ${mismatch?'<div class="swap-banner" style="background:#FCEBEB;color:#791F1F;border:.5px solid #F09595">&#9888; Actual custody differs from what was scheduled.</div>':''}
    ${!schedChanged&&!mismatch&&ov?'<div class="on2">&#9888; Actual custody overridden.</div>':''}

    <div class="sched-actual-grid">
      <div class="sa-col scheduled">
        <h4 style="color:var(--ev)">&#128197; Scheduled parent</h4>
        <div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Who SHOULD have the kids. Change for swaps or deviations.</div>
        ${schedChildRow('zeke')}
        ${schedChildRow('gus')}
        ${schedChanged?`
          <div style="margin-top:8px">
            <div style="font-size:10px;color:var(--tx2);margin-bottom:4px;font-weight:500">REASON FOR CHANGE</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
              ${Object.keys(REASONS).map(r=>`<button class="btn ${curReason===r?'bp':'bo'}" style="font-size:10px;padding:4px 8px" onclick="setSchedReasonFn('${r}',document.getElementById('sched-note-input')?.value||'')">${REASONS[r].icon} ${REASONS[r].label}</button>`).join('')}
            </div>
            <input id="sched-note-input" type="text" placeholder="Optional note (e.g. 'Kelly asked to swap for wedding')" value="${esc(schedR.reasonNote)}" onchange="setSchedReasonFn('${curReason}',this.value)" style="width:100%;padding:7px 10px;border:.5px solid rgba(0,0,0,.1);border-radius:6px;font-size:12px;font-family:inherit" />
          </div>
          <div class="ar" style="margin-top:6px"><button class="btn bo bsm" onclick="resetSched()">Reset to court order</button></div>
        `:''}
      </div>
      <div class="sa-col actual">
        <h4 style="color:var(--dad)">&#9989; Actual custody</h4>
        <div style="font-size:10px;color:var(--tx3);margin-bottom:8px">Who ACTUALLY had the kids this day.</div>
        ${actualChildRow('zeke')}
        ${actualChildRow('gus')}
        ${ov?'<div class="ar" style="margin-top:6px"><button class="btn bo bsm" onclick="resetDay()">Reset to scheduled</button></div>':''}
      </div>
    </div>

    <div class="psec"><h3>Log evidence</h3>
      <div class="fg"><div class="fr"><label>Type</label><select id="ev-type"><option value="text">Text message</option><option value="email">Email</option><option value="document">Document</option><option value="photo">Photo/screenshot</option><option value="note">Note</option></select></div>
      <div class="fr"><label>From</label><select id="ev-from-sel" onchange="document.getElementById('ev-from-cust').style.display=this.value==='_custom'?'block':'none'"><option value="Kelly (Ex)">Kelly — Ex</option><option value="James (Ex Husband)">James — Ex's Husband</option><option value="Attorney">Attorney</option><option value="School">School</option><option value="Court">Court</option><option value="Self">Self</option><option value="_custom">Other...</option></select><input type="text" id="ev-from-cust" placeholder="Name..." style="display:none;margin-top:6px;width:100%;padding:9px 11px;border:.5px solid rgba(0,0,0,.1);border-radius:6px;font-size:13px" /></div></div>
      <div class="fr"><label>Child</label><select id="ev-child"><option value="both">Both</option><option value="zeke">Zeke</option><option value="gus">Gus</option></select></div>
      <div class="fr"><label>Content</label><textarea id="ev-content" style="width:100%;padding:9px 11px;border:.5px solid rgba(0,0,0,.1);border-radius:6px;font-size:13px;min-height:60px;resize:vertical;font-family:inherit" placeholder="Paste text, email..."></textarea></div>
      <div class="fg"><div class="fr"><label>Time</label><input type="time" id="ev-time" /></div><div class="fr"><label>Importance</label><select id="ev-imp"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></div></div>
      <div class="fr"><label>Attach</label><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px"><button class="btn bo" style="justify-content:center;font-size:11px;padding:10px 6px" onclick="document.getElementById('file-pick').click()">&#128206; Files</button><button class="btn bo" style="justify-content:center;font-size:11px;padding:10px 6px" onclick="document.getElementById('camera-pick').click()">&#128247; Camera</button><button class="btn bo" style="justify-content:center;font-size:11px;padding:10px 6px" onclick="captureScreen()">&#128241; Screenshot</button></div>
      <div class="uz" data-target="evidence"><input type="file" multiple accept="*/*" onchange="hf(this.files,'evidence');this.value='';" /><div style="font-size:18px;color:var(--tx3);margin-bottom:3px">&#128206;</div><div style="font-size:11px;color:var(--tx2)">Or drag here</div></div>${ph}</div>
      <div class="ar"><button class="btn bp" onclick="addEv()">Save${S.pf.length?` + ${S.pf.length}f`:''}</button>${S.pf.length?'<button class="btn bo" onclick="S.pf=[];R()">Clear</button>':''}</div>
    </div>
    ${ev.length?`<div class="psec"><h3>Evidence (${ev.length})</h3><div class="el">${ev.map((e,i)=>rEnt(e,i)).join('')}</div></div>`:''}
    <div class="psec"><h3>Exchange</h3><div class="fg"><div class="fr"><label>Type</label><select id="xc-type"><option value="pickup">Pickup</option><option value="dropoff">Dropoff</option></select></div><div class="fr"><label>Child</label><select id="xc-child"><option value="both">Both</option><option value="zeke">Zeke</option><option value="gus">Gus</option></select></div></div><div class="fg"><div class="fr"><label>Time</label><input type="time" id="xc-time" /></div><div class="fr"><label>Location</label><input type="text" id="xc-loc" /></div></div><div class="fr"><label>Notes</label><textarea id="xc-notes" style="width:100%;padding:9px 11px;border:.5px solid rgba(0,0,0,.1);border-radius:6px;font-size:13px;min-height:40px;font-family:inherit"></textarea></div><div class="ar"><button class="btn bs" onclick="addXc()">Save exchange</button></div></div>
    ${xc.length?`<div class="psec"><h3>Exchanges (${xc.length})</h3>${xc.map((x,i)=>`<div class="xi"><span style="font-size:9px;padding:2px 7px;border-radius:4px;font-weight:500;background:var(--pink-bg);color:var(--pink-fg);text-transform:uppercase">${x.type==='pickup'?'PU':'DO'}</span><span style="font-size:9px;padding:2px 7px;border-radius:4px;font-weight:500;background:${x.child==='gus'?'var(--gus-bg)':x.child==='zeke'?'var(--zeke-bg)':'var(--gray-bg)'};color:${x.child==='gus'?'var(--gus-fg)':x.child==='zeke'?'var(--zeke-fg)':'var(--gray-fg)'}">${x.child==='both'?'Both':KN[x.child]||'Both'}</span><div style="flex:1;font-size:11px">${esc(x.location||'')} ${x.notes?'— '+esc(x.notes):''}</div><span style="color:var(--tx3);font-size:10px">${x.time||''}</span><button class="edel" onclick="delXc(${i})">&times;</button></div>`).join('')}</div>`:''}
  </div>`;
}

function rEnt(e,i){const c=tc2(e.type);let imp='';if(e.importance==='high')imp='<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:var(--warn-bg);color:var(--warn-fg);font-weight:500;margin-left:3px">HIGH</span>';if(e.importance==='critical')imp='<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:#FCEBEB;color:#A32D2D;font-weight:500;margin-left:3px">CRIT</span>';const childBadge=e.child&&e.child!=='both'?`<span style="font-size:9px;padding:1px 6px;border-radius:10px;margin-left:4px;background:${e.child==='gus'?'var(--gus-bg)':'var(--zeke-bg)'};color:${e.child==='gus'?'var(--gus-fg)':'var(--zeke-fg)'};font-weight:500">${KN[e.child]}</span>`:'';let fh='';if(e.files&&e.files.length)fh=`<div class="afs">${e.files.map(f=>{const inf=fi(f.name);return`<span class="af" style="background:${inf.bg};color:${inf.fg}" onclick="event.stopPropagation();viewF('${f.id}')">${inf.i} ${esc(f.name)}</span>`}).join('')}</div>`;return`<div class="ei"><span class="et" style="background:${c.bg};color:${c.fg}">${tl(e.type)}</span><div class="ec"><div class="tx">${esc(e.content)}${imp}${childBadge}</div>${fh}<div class="mt2">${e.from?fromBadge(e.from):''}${e.time?'<span>'+e.time+'</span>':''}</div></div><button class="edel" onclick="delEv(${i})">&times;</button></div>`}

// Evidence Log, Vault, Exchanges, Summary, Settings — same as before, condensed
function renderEvLog(){const list=filtEv(),types=['all','text','email','document','photo','note'],ae=allEv(),cn={};types.forEach(t=>cn[t]=t==='all'?ae.length:ae.filter(e=>e.type===t).length);const fromP=[...new Set(ae.map(e=>e.from).filter(Boolean))].sort();return`<div class="panel"><h3>Evidence log</h3><div class="srch"><span class="si">&#128269;</span><input type="text" placeholder="Search..." value="${esc(S.sq)}" oninput="S.sq=this.value;R()" /></div><div class="frow">${types.map(t=>`<button class="fb ${S.ef===t?'act':''}" onclick="S.ef='${t}';R()">${t==='all'?'All':tl(t)} (${cn[t]})</button>`).join('')}</div>${fromP.length>1?`<div class="frow"><span style="font-size:10px;color:var(--tx3);padding:4px 0">From:</span><button class="fb ${!S.efFrom?'act':''}" onclick="S.efFrom=null;R()">All</button>${fromP.map(p=>`<button class="fb ${S.efFrom===p?'act':''}" onclick="S.efFrom=S.efFrom==='${esc(p)}'?null:'${esc(p)}';R()">${esc(p)}</button>`).join('')}</div>`:''} ${list.length===0?`<div class="es">${S.sq?'No matches':'No evidence'}</div>`:`<div style="overflow-x:auto"><table class="evt"><thead><tr><th>Date</th><th>Type</th><th>Child</th><th>From</th><th>Content</th><th>Flag</th></tr></thead><tbody>${list.map(e=>{const c=tc2(e.type);let fl='';if(e.importance==='high')fl='<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:var(--warn-bg);color:var(--warn-fg);font-weight:500">HIGH</span>';if(e.importance==='critical')fl='<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:#FCEBEB;color:#A32D2D;font-weight:500">CRIT</span>';return`<tr><td style="white-space:nowrap;cursor:pointer;color:var(--ev)" onclick="goTo('${e.date}')">${fmS(e.date)}</td><td><span class="tg" style="background:${c.bg};color:${c.fg}">${tl(e.type)}</span></td><td>${e.child==='gus'?'Gus':e.child==='zeke'?'Zeke':'Both'}</td><td>${e.from?fromBadge(e.from):'—'}</td><td class="ccc" title="${esc(e.content)}">${esc(e.content)}</td><td>${fl||'—'}</td></tr>`}).join('')}</tbody></table></div>`}</div>`}

function renderVault(){const cats=Object.keys(VCAT),filt=S.vf==='all'?vault:vault.filter(d=>d.category===S.vf);let vpH='';if(S.vp.length)vpH=`<div class="fpl">${S.vp.map((f,i)=>{const inf=fi(f.name);return`<div class="fp" title="${esc(f.name)}">${isImg(f.name)?`<img src="${f.base64}">`:`<div class="fpi">${inf.i}</div>`}<div class="fpb" style="background:${inf.bg};color:${inf.fg}">${inf.l}</div><div class="fpn">${esc(f.name)}</div><button class="fpr" onclick="event.stopPropagation();rvp(${i})">&times;</button></div>`}).join('')}</div>`;return`<div class="panel"><h3>Documents vault</h3><div class="vu" data-target="vault"><input type="file" multiple accept="*/*" onchange="hf(this.files,'vault');this.value='';" /><div style="font-size:28px;color:var(--tx3);margin-bottom:6px">&#128193;</div><div style="font-size:13px;color:var(--tx2);font-weight:500">Upload to vault</div></div>${vpH}${S.vp.length?`<div class="panel" style="border:.5px solid var(--ev);margin-bottom:14px"><h3>Save files</h3><div class="fr"><label>Category</label><select id="v-cat">${cats.map(c=>`<option value="${c}">${VCAT[c].l}</option>`).join('')}</select></div><div class="fr"><label>Notes</label><textarea id="v-notes" style="width:100%;padding:9px 11px;border:.5px solid rgba(0,0,0,.1);border-radius:6px;font-size:13px;min-height:50px;font-family:inherit"></textarea></div><div class="fr"><label>Date</label><input type="date" id="v-date" /></div><div class="ar"><button class="btn bp" onclick="saveV()">Save</button><button class="btn bo" onclick="S.vp=[];R()">Cancel</button></div></div>`:''}<div class="frow"><button class="fb ${S.vf==='all'?'act':''}" onclick="S.vf='all';R()">All (${vault.length})</button>${cats.filter(c=>vault.some(d=>d.category===c)).map(c=>`<button class="fb ${S.vf===c?'act':''}" onclick="S.vf='${c}';R()">${VCAT[c].l} (${vault.filter(d=>d.category===c).length})</button>`).join('')}</div>${filt.length===0?'<div class="es">No documents</div>':`<div class="dg">${filt.map((d,_)=>{const ri=vault.indexOf(d),inf=fi(d.fileName),cat=VCAT[d.category]||VCAT.other;return`<div class="dcard" onclick="viewVF(${ri})"><div class="dca"><button onclick="event.stopPropagation();dlf('${d.fileId}')">&#8595;</button><button onclick="event.stopPropagation();delV(${ri})" style="color:#A32D2D">&times;</button></div><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><div style="font-size:24px">${inf.i}</div><span style="font-size:8px;padding:2px 5px;border-radius:3px;font-weight:500;background:${inf.bg};color:${inf.fg}">${inf.l}</span></div><div style="font-size:12px;font-weight:500">${esc(d.title||d.fileName)}</div><div style="font-size:10px;color:var(--tx3);margin-top:4px">${d.notes?esc(d.notes)+'<br>':''}${fz(d.fileSize)}${d.docDate?' &bull; '+d.docDate:''}</div><div style="font-size:9px;padding:2px 7px;border-radius:10px;font-weight:500;display:inline-block;margin-top:4px;background:${cat.bg};color:${cat.fg}">${cat.l}</div></div>`}).join('')}</div>`}</div>`}

function renderXchg(){const all=[];Object.keys(S.days).sort().reverse().forEach(k=>{(S.days[k].exchanges||[]).forEach(x=>all.push({date:k,...x}))});return`<div class="panel"><h3>Exchanges</h3>${all.length===0?'<div class="es">None</div>':`<div style="overflow-x:auto"><table class="evt"><thead><tr><th>Date</th><th>Type</th><th>Child</th><th>Time</th><th>Location</th><th>Notes</th></tr></thead><tbody>${all.map(x=>`<tr><td style="cursor:pointer;color:var(--ev)" onclick="goTo('${x.date}')">${fmS(x.date)}</td><td><span class="tg" style="background:var(--pink-bg);color:var(--pink-fg)">${x.type==='pickup'?'PU':'DO'}</span></td><td>${x.child==='gus'?'Gus':x.child==='zeke'?'Zeke':'Both'}</td><td>${x.time||'—'}</td><td>${esc(x.location||'—')}</td><td class="ccc">${esc(x.notes||'—')}</td></tr>`).join('')}</tbody></table></div>`}</div>`}

function renderSum(){let gD=0,gO=0,zD=0,zO=0,gMd=0,gMo=0,zMd=0,zMo=0;for(let y=2025;y<=2026;y++)for(let m=0;m<12;m++){const dim=new Date(y,m+1,0).getDate();for(let d=1;d<=dim;d++){const k=dk(y,m,d),ge=getEff(k,'gus'),ze=getEff(k,'zeke');if(ge.daytime==='dad')gD++;else gMd++;if(ge.overnight==='dad')gO++;else gMo++;if(ze.daytime==='dad')zD++;else zMd++;if(ze.overnight==='dad')zO++;else zMo++}}const gTd=gD+gMd,gPd=gTd?Math.round(gD/gTd*100):0,gTo=gO+gMo,gPo=gTo?Math.round(gO/gTo*100):0,zTd=zD+zMd,zPd=zTd?Math.round(zD/zTd*100):0,zTo=zO+zMo,zPo=zTo?Math.round(zO/zTo*100):0;
  function bar(pct,lc,rc){return`<div style="display:flex;border-radius:6px;overflow:hidden;height:20px;margin:8px 0"><div style="width:${pct}%;background:${lc};color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;min-width:24px">${pct}%</div><div style="width:${100-pct}%;background:${rc};color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;min-width:24px">${100-pct}%</div></div>`}
  return`<div class="panel"><h3>Gus (2025–26)</h3><div style="font-size:12px;color:var(--tx2);margin-bottom:4px">Daytime: Father ${gPd}% (${gD}) / Mother ${100-gPd}% (${gMd})</div>${bar(gPd,'var(--gus)','var(--mom)')}<div style="font-size:12px;color:var(--tx2);margin-bottom:4px;margin-top:12px">Overnights: Father ${gPo}% (${gO}) / Mother ${100-gPo}% (${gMo})</div>${bar(gPo,'var(--on)','var(--mom)')}</div>
  <div class="panel"><h3>Zeke (2025–26)</h3><div style="font-size:12px;color:var(--tx2);margin-bottom:4px">Daytime: Father ${zPd}% (${zD}) / Mother ${100-zPd}% (${zMd})</div>${bar(zPd,'var(--zeke)','var(--mom)')}<div style="font-size:12px;color:var(--tx2);margin-bottom:4px;margin-top:12px">Overnights: Father ${zPo}% (${zO}) / Mother ${100-zPo}% (${zMo})</div>${bar(zPo,'var(--on)','var(--mom)')}</div>
  <div class="panel no-print"><h3>Data</h3><div class="ar" style="margin-top:0"><button class="btn bo" onclick="xpAll()">Export JSON</button><button class="btn bo" onclick="xpCSV()">Evidence CSV</button><button class="btn bo" onclick="window.print()">Print</button><button class="btn bd" onclick="resetAll()">Reset all</button></div></div>`}

function renderCfg(){return`<div class="panel"><h3>Court order schedule</h3><p style="font-size:12px;color:var(--tx2);margin-bottom:14px">Gunderson v. Winkels — applies equally to Zeke &amp; Gus.</p>
  <div class="sr"><div><b>School year</b><div style="font-size:12px;color:var(--tx2);margin-top:2px">Father: Thu after school → Sun 7pm every weekend. ON Thu/Fri/Sat.</div></div></div>
  <div class="sr"><div><b>2nd weekend</b><div style="font-size:12px;color:var(--tx2);margin-top:2px">The weekend (Thu–Sun) after the 1st Sunday of each month → Mother's. Father: Thu overnight only (→ Fri 8am).</div></div></div>
  <div class="sr"><div><b>Summer</b><div style="font-size:12px;color:var(--tx2);margin-top:2px">First Fri after school out → Labor Day. Alternating weeks, 5pm Fri.</div></div></div>
  <div class="sr"><div><b>Father first summer week</b></div><div class="tgl ${cfg.summerFirstWeekFather?'on':''}" onclick="cfg.summerFirstWeekFather=!cfg.summerFirstWeekFather;svCfg();R()"></div></div>
  <div class="fg" style="margin-top:14px"><div class="fr"><label>School out 2025</label><input type="date" value="${cfg.schoolOut2025}" onchange="cfg.schoolOut2025=this.value;svCfg();R()" /></div><div class="fr"><label>Labor Day 2025</label><input type="date" value="${cfg.laborDay2025}" onchange="cfg.laborDay2025=this.value;svCfg();R()" /></div><div class="fr"><label>School out 2026</label><input type="date" value="${cfg.schoolOut2026}" onchange="cfg.schoolOut2026=this.value;svCfg();R()" /></div><div class="fr"><label>Labor Day 2026</label><input type="date" value="${cfg.laborDay2026}" onchange="cfg.laborDay2026=this.value;svCfg();R()" /></div></div></div>`}

function renderModal(){if(!S.modal)return'';const f=S.modal.file;if(!f)return'';let p='';if(isImg(f.name))p=`<img src="${f.base64}" style="max-width:100%;border-radius:var(--r)">`;else if(isPDF(f.name))p=`<iframe src="${f.base64}" style="width:100%;height:70vh;border:none;border-radius:var(--r)"></iframe>`;else{const inf=fi(f.name);p=`<div style="text-align:center;padding:2rem"><div style="font-size:40px;margin-bottom:10px">${inf.i}</div><div style="font-size:14px;font-weight:500">${esc(f.name)}</div><div style="font-size:11px;color:var(--tx3);margin:6px 0">${inf.l} — ${fz(f.size)}</div><div style="font-size:12px;color:var(--tx2)">Download to open.</div></div>`}return`<div class="mo" onclick="if(event.target===this){S.modal=null;R()}"><div class="mod"><button class="mc" onclick="S.modal=null;R()">&times;</button><h3>${esc(f.name)}</h3>${p}<div style="margin-top:10px;display:flex;gap:6px"><button class="btn bp" onclick="dlf('${f.id}')">Download</button><button class="btn bo" onclick="S.modal=null;R()">Close</button></div></div></div>`}

// ═══ INIT ═══
loadAll().then(()=>R()).catch(e=>{console.error('Load error:',e);R()});

// Fallback: if loadAll hangs, force render after 3 seconds
setTimeout(()=>{const app=document.getElementById('app');if(app&&app.innerHTML.includes('Loading')){console.warn('Forced render after timeout');R()}},3000);

// PWA install
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e});
