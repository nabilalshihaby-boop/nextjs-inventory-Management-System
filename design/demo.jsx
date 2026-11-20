(()=>{
const {Modal,Field,Input,Button,Badge,Icon}=window.Industry_indust,DEMO=window.DEMO;
function useDemo(){const [,f]=React.useReducer(x=>x+1,0);React.useEffect(()=>{window.addEventListener("sp-demo",f);return()=>window.removeEventListener("sp-demo",f)},[]);return DEMO.get()}
function useToast(initial){const [m,setM]=React.useState(initial||null);React.useEffect(()=>{if(!m)return;const t=setTimeout(()=>setM(null),4000);return()=>clearTimeout(t)},[m]);
const node=m?<div role="status" className="sp-badge sp-badge--success" style={{position:"fixed",right:24,bottom:24,zIndex:300,height:44,padding:"0 18px",fontSize:14,boxShadow:"var(--shadow-lg)"}}><Icon name="circle-check" size={18}/>{m}</div>:null;return[node,setM]}
const FIELDS=[["name","Name","Enter Name"],["email","Email","Enter Email"],["phone","Phone Number","Phone Number"],["country","Country","Enter Country"],["city","City","Enter City"],["address","Address","Enter Address"]];
function SupplierModal({open,onClose,onSaved}){const [f,setF]=React.useState({});const [e,setE]=React.useState({});
React.useEffect(()=>{if(open){setF({});setE({})}},[open]);
const save=()=>{const n={};FIELDS.forEach(([k,l])=>{if(!String(f[k]||"").trim())n[k]=l+" is required"});if(f.email&&!/^\S+@\S+\.\S+$/.test(f.email))n.email="Enter a valid email";setE(n);if(Object.keys(n).length)return;const s=DEMO.addSupplier(f);onSaved&&onSaved(s)};
return <Modal open={open} size="md" title="Create Supplier" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
<div className="sp-form-grid">{FIELDS.map(([k,l,ph])=><Field key={k} label={l} required error={e[k]}><Input placeholder={ph} value={f[k]||""} onChange={ev=>{setF({...f,[k]:ev.target.value});setE({...e,[k]:""})}}/></Field>)}</div></Modal>}
Object.assign(window,{useDemo,useToast,SupplierModal});
})();
