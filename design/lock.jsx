(()=>{
const {Modal,Field,Input,Button,Switch,Icon,ConfirmDeleteModal}=window.Industry_indust;
const KEY="sp.poslock.v1",DEF={hash:"",salt:"",auto:true,secs:30};
const validPin=c=>!!c&&typeof c.hash==="string"&&/^[0-9a-f]{6,64}$/.test(c.hash)&&typeof c.salt==="string"&&c.salt.length>=8;
const load=()=>{let r=null;try{r=JSON.parse(localStorage.getItem(KEY))}catch(e){}if(!r||typeof r!=="object"||Array.isArray(r))r={};const c={...DEF,auto:typeof r.auto==="boolean"?r.auto:DEF.auto,secs:Number.isInteger(r.secs)&&r.secs>=15?r.secs:DEF.secs};if(validPin(r)){c.hash=r.hash;c.salt=r.salt}return c};
const store=v=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}};
const fallback=s=>{let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))>>>0;return h.toString(16)};
async function digest(pin,salt){const t=salt+":"+pin;try{if(window.crypto&&crypto.subtle){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}}catch(e){}return fallback(t)}
const rnd=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const clean=v=>v.replace(/\D/g,"").slice(0,6);
const PRESETS=[30,60,120,300];
function Dots({n,error}){return <div style={{display:"flex",gap:10,justifyContent:"center",margin:"4px 0"}} aria-hidden="true">{[0,1,2,3,4,5].map(i=><span key={i} style={{width:14,height:14,borderRadius:"50%",border:"2px solid "+(error?"var(--danger-500)":"var(--primary-600)"),background:i<n?(error?"var(--danger-500)":"var(--primary-600)"):"transparent",transition:"background .12s"}}/>)}</div>}
function PinField({label,value,onChange,error,autoFocus,hint}){return <Field label={label} required error={error} hint={hint}><Input type="password" inputMode="numeric" autoComplete="off" autoFocus={autoFocus} placeholder="4–6 digits" value={value} onChange={e=>onChange(clean(e.target.value))}/></Field>}
function LockOverlay({user,verify,onUnlock}){const [pin,setPin]=React.useState("");const [err,setErr]=React.useState("");const [shake,setShake]=React.useState(false);const [busy,setBusy]=React.useState(false);
const add=d=>{setErr("");setPin(p=>p.length<6?p+d:p)};const del=()=>{setErr("");setPin(p=>p.slice(0,-1))};const clr=()=>{setErr("");setPin("")};
const submit=async()=>{if(pin.length<4){setErr("Enter your 4–6 digit PIN");return}setBusy(true);const ok=await verify(pin);setBusy(false);if(ok){onUnlock()}else{setErr("Incorrect PIN. Try again.");setPin("");setShake(true);setTimeout(()=>setShake(false),400)}};
const ref=React.useRef();ref.current={add,del,clr,submit};
React.useEffect(()=>{const h=e=>{const r=ref.current;if(/^[0-9]$/.test(e.key))r.add(e.key);else if(e.key==="Backspace")r.del();else if(e.key==="Delete"||e.key==="Escape")r.clr();else if(e.key==="Enter")r.submit();else if(e.key!=="Tab")return;if(e.key!=="Tab")e.preventDefault()};window.addEventListener("keydown",h,true);return()=>window.removeEventListener("keydown",h,true)},[]);
const key={height:60,font:"600 22px/1 var(--font-body)",background:"#fff",color:"var(--text-1)",border:"1px solid var(--border)",borderRadius:"var(--radius-md)",cursor:"pointer",transition:"background .12s,transform .08s"};
return <div role="dialog" aria-modal="true" aria-label="POS locked" style={{position:"fixed",inset:0,zIndex:1000,background:"var(--primary-50)",display:"flex",alignItems:"center",justifyContent:"center",animation:"sp-lock-in .25s ease"}}>
<style>{"@keyframes sp-lock-in{from{opacity:0}to{opacity:1}}@keyframes sp-lock-shake{25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}.sp-lockkey:hover{background:var(--primary-100)!important}.sp-lockkey:active{transform:scale(.96)}"}</style>
<div style={{width:380,maxWidth:"92vw",background:"#fff",border:"1px solid var(--border)",borderRadius:"var(--radius-lg)",boxShadow:"var(--shadow-lg)",padding:"32px 32px 28px",display:"flex",flexDirection:"column",alignItems:"center",gap:16,animation:shake?"sp-lock-shake .4s":undefined}}>
<div style={{font:"700 22px/28px var(--font-heading,var(--font-body))",color:"var(--primary-700)"}}>Sontic Plus</div>
<div style={{width:84,height:84,borderRadius:"50%",background:"var(--primary-100)",color:"var(--primary-700)",display:"grid",placeItems:"center"}}><Icon name="lock" size={40}/></div>
<div style={{textAlign:"center"}}><h2 className="t-section-title" style={{margin:0}}>POS Locked</h2><p className="t-body" style={{margin:"6px 0 0",color:"var(--text-2)"}}>Enter your PIN to continue</p>{user&&<p className="t-caption" style={{margin:"6px 0 0"}}>Signed in as {user}</p>}</div>
<Dots n={pin.length} error={!!err}/><div role="alert" style={{minHeight:20,font:"500 13px/20px var(--font-body)",color:"var(--danger-500)"}}>{err}</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,width:"100%"}}>{["1","2","3","4","5","6","7","8","9"].map(d=><button key={d} type="button" className="sp-lockkey" style={key} onClick={()=>add(d)}>{d}</button>)}
<button type="button" className="sp-lockkey" style={{...key,font:"600 14px/1 var(--font-body)",color:"var(--text-2)"}} onClick={clr}>Clear</button><button type="button" className="sp-lockkey" style={key} onClick={()=>add("0")}>0</button><button type="button" className="sp-lockkey" style={{...key,color:"var(--text-2)"}} onClick={del} aria-label="Delete"><Icon name="delete" size={22}/></button></div>
<Button size="lg" icon="lock-open" disabled={busy||pin.length<4} style={{width:"100%"}} onClick={submit}>Unlock</Button></div></div>}
function usePosLock({paused}){
const [cfg,setCfg]=React.useState(load);const [locked,setLocked]=React.useState(false);const [setup,setSetup]=React.useState(null);const [settings,setSettings]=React.useState(false);const [change,setChange]=React.useState(false);const [rm,setRm]=React.useState(false);
const [left,setLeft]=React.useState(0);const last=React.useRef(Date.now());const [secsText,setSecsText]=React.useState(String(load().secs));const [secsErr,setSecsErr]=React.useState("");
const hasPin=validPin(cfg);const persist=v=>{setCfg(v);store(v)};
const verify=async p=>(await digest(p,cfg.salt))===cfg.hash;
const lockNow=()=>{if(!validPin(load())||!hasPin){setSetup({step:1,a:"",b:"",err:""});return}setSettings(false);setChange(false);setLocked(true)};
const blocked=paused||locked||!!setup||change;
React.useEffect(()=>{const bump=()=>{last.current=Date.now()};const ev=["mousemove","mousedown","keydown","touchstart","wheel","scroll"];ev.forEach(e=>window.addEventListener(e,bump,true));return()=>ev.forEach(e=>window.removeEventListener(e,bump,true))},[]);
React.useEffect(()=>{if(!blocked)last.current=Date.now()},[blocked]);
React.useEffect(()=>{if(!hasPin||locked)return;const t=setInterval(()=>{const rem=Math.max(0,cfg.secs*1000-(Date.now()-last.current));setLeft(Math.ceil(rem/1000));if(cfg.auto&&hasPin&&!blocked&&rem<=0){setSettings(false);setLocked(true)}},500);return()=>clearInterval(t)},[cfg,hasPin,blocked]);
const submitSetup=async()=>{const s=setup;if(!/^\d{4,6}$/.test(s.a))return setSetup({...s,step:1,err:"PIN must be 4–6 digits"});if(s.step===1){if(s.a.length<4)return setSetup({...s,err:"PIN must be 4–6 digits"});return setSetup({...s,step:2,err:""})}
if(s.b!==s.a)return setSetup({...s,err:"PINs do not match. Try again."});const salt=rnd();const hash=await digest(s.a,salt);const next={...cfg,hash,salt};if(!validPin(next))return setSetup({...s,err:"Could not save the PIN. Try again."});persist(next);setSetup(null);setLocked(true)};
const [cp,setCp]=React.useState({cur:"",n:"",c:"",e:{}});
const openChange=()=>{setCp({cur:"",n:"",c:"",e:{}});setSettings(false);setChange(true)};
const saveChange=async()=>{const e={};if(!cp.cur)e.cur="Current PIN is required";else if(!(await verify(cp.cur)))e.cur="Current PIN is incorrect";if(cp.n.length<4)e.n="New PIN must be 4–6 digits";if(cp.c!==cp.n)e.c="PINs do not match";if(Object.keys(e).length)return setCp({...cp,e});const salt=rnd();persist({...cfg,salt,hash:await digest(cp.n,salt)});setChange(false);setSettings(true)};
const commitSecs=t=>{setSecsText(t);const n=+t;if(!t||isNaN(n)||n<15||!Number.isInteger(n)){setSecsErr("Enter a whole number of at least 15 seconds");return}setSecsErr("");persist({...cfg,secs:n});last.current=Date.now()};
const preset=n=>{setSecsText(String(n));setSecsErr("");persist({...cfg,secs:n});last.current=Date.now()};
const node=<>
<Modal open={!!setup} size="sm" title="Set Up Your POS PIN" onClose={()=>setSetup(null)} footer={setup&&<>{setup.step===2?<Button variant="secondary" onClick={()=>setSetup({...setup,step:1,b:"",err:""})}>Back</Button>:null}<Button variant="secondary" onClick={()=>setSetup(null)}>Cancel</Button><Button onClick={submitSetup}>{setup.step===1?"Continue":"Confirm & Lock"}</Button></>}>
{setup&&<div style={{display:"flex",flexDirection:"column",gap:16}}><p className="t-caption" style={{margin:0}}>Step {setup.step} of 2 · {setup.step===1?"Choose a 4–6 digit numeric PIN.":"Enter the PIN again to confirm."}</p>
<PinField key={setup.step} autoFocus label={setup.step===1?"New PIN":"Confirm PIN"} value={setup.step===1?setup.a:setup.b} error={setup.err} onChange={v=>setSetup(setup.step===1?{...setup,a:v,err:""}:{...setup,b:v,err:""})}/>
<Dots n={(setup.step===1?setup.a:setup.b).length}/><p className="t-caption" style={{margin:0}}>Demo only. The PIN is kept in this browser as a salted hash.</p></div>}</Modal>
<Modal open={settings} size="sm" title="Lock Settings" onClose={()=>setSettings(false)} footer={<Button variant="secondary" onClick={()=>setSettings(false)}>Close</Button>}>
<div style={{display:"flex",flexDirection:"column",gap:20}}><div className="t-label">Security Settings</div>
<Switch label="Auto-Lock" checked={cfg.auto} onChange={e=>persist({...cfg,auto:e.target.checked})}/>
<Field label="Lock After (seconds)" required error={secsErr} hint="Minimum 15 seconds"><Input type="number" min="15" addon="sec" disabled={!cfg.auto} value={secsText} onChange={e=>commitSecs(e.target.value)}/></Field>
<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{PRESETS.map(n=><button key={n} type="button" disabled={!cfg.auto} className="pos-chip" style={{height:36,padding:"0 14px",font:"600 13px/1 var(--font-body)",opacity:cfg.auto?1:.5}} aria-pressed={cfg.secs===n} onClick={()=>preset(n)}>{n} sec</button>)}</div>
{!hasPin&&<div className="sp-badge sp-badge--warning" style={{height:"auto",padding:"10px 14px",whiteSpace:"normal"}}><Icon name="triangle-alert" size={16}/>Set a PIN to activate auto-lock.</div>}
{hasPin&&cfg.auto&&<div className="t-caption" style={{background:"var(--neutral-100)",borderRadius:"var(--radius-md)",padding:"8px 12px"}}>Test aid: locks in <b>{Math.max(0,left)}</b> s without activity (settings stay open, move the mouse to reset).</div>}
<Button variant="secondary" icon="key-round" onClick={hasPin?openChange:()=>{setSettings(false);setSetup({step:1,a:"",b:"",err:""})}}>{hasPin?"Change PIN":"Set Up PIN"}</Button>{hasPin&&<Button variant="danger" icon="trash-2" onClick={()=>{setSettings(false);setRm(true)}}>Remove PIN</Button>}</div></Modal>
<ConfirmDeleteModal open={rm} itemType="POS PIN" itemName="the POS PIN" onCancel={()=>setRm(false)} onConfirm={()=>{persist({...cfg,hash:"",salt:""});setRm(false);setSettings(true)}}/>
<Modal open={change} size="sm" title="Change PIN" onClose={()=>{setChange(false);setSettings(true)}} footer={<><Button variant="secondary" onClick={()=>{setChange(false);setSettings(true)}}>Cancel</Button><Button onClick={saveChange}>Save Changes</Button></>}>
<div style={{display:"flex",flexDirection:"column",gap:16}}><PinField autoFocus label="Current PIN" value={cp.cur} error={cp.e.cur} onChange={v=>setCp({...cp,cur:v,e:{...cp.e,cur:""}})}/><PinField label="New PIN" value={cp.n} error={cp.e.n} onChange={v=>setCp({...cp,n:v,e:{...cp.e,n:""}})}/><PinField label="Confirm New PIN" value={cp.c} error={cp.e.c} onChange={v=>setCp({...cp,c:v,e:{...cp.e,c:""}})}/></div></Modal>
{locked&&<LockOverlay user="admin" verify={verify} onUnlock={()=>{setLocked(false);last.current=Date.now()}}/>}</>;
return{lockNow,openSettings:()=>{last.current=Date.now();setSecsText(String(cfg.secs));setSecsErr("");setSettings(true)},node,locked};}
window.usePosLock=usePosLock;
})();
