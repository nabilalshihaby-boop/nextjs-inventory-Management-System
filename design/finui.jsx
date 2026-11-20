(()=>{
const {Modal,Field,Input,Select,Textarea,Button}=window.Industry_indust,FIN=window.FIN;
const egp=n=>"EGP "+(+n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function useFin(){const [,f]=React.useReducer(x=>x+1,0);React.useEffect(()=>{window.addEventListener("sp-fin",f);return()=>window.removeEventListener("sp-fin",f)},[]);return FIN.get()}
function PaymentModal({kind,open,onClose,party,onSaved}){const C=kind==="customer";useFin();
const [f,setF]=React.useState({}),[e,setE]=React.useState({}),[id,setId]=React.useState(""),[done,setDone]=React.useState(false);
React.useEffect(()=>{if(open){setId("p"+Date.now().toString(36)+Math.random().toString(36).slice(2,6));setF({party:party||"",date:"2026-05-31",amount:"",method:"Cash",acct:"",inv:"",txn:"",notes:""});setE({});setDone(false)}},[open]);
const names=FIN.parties(kind),inv=f.party?FIN.openInvoices(kind,f.party):[],out=f.party?FIN.outstanding(kind,f.party):null,sel=inv.find(i=>i.ref===f.inv);
const set=k=>v=>{setF({...f,[k]:v});setE({...e,[k]:""})};
const L=C?{who:"Customer",amt:"Amount Collected",acct:"Deposit To — Cash / Bank Account",inv:"Related Sales Invoice (optional)",save:"Save Payment",title:"Record Customer Payment",bal:"Customer Outstanding Balance"}:{who:"Supplier",amt:"Payment Amount",acct:"Pay From — Cash / Bank Account",inv:"Related Purchase Invoice (optional)",save:"Save Payment",title:"Record Supplier Payment",bal:"Supplier Outstanding Balance"};
const save=()=>{if(done)return;const n={};if(!f.party)n.party=L.who+" is required";if(!f.date)n.date="Payment date is required";if(!(+f.amount>0))n.amount="Enter an amount greater than 0";else if(sel&&+f.amount>sel.amt)n.amount="Exceeds the invoice balance ("+egp(sel.amt)+")";else if(!C&&f.acct&&+f.amount>FIN.balance(f.acct))n.amount="Insufficient account balance ("+egp(FIN.balance(f.acct))+")";if(!f.acct)n.acct="Select an account";setE(n);if(Object.keys(n).length)return;
setDone(true);const r=FIN.add({id,kind,party:f.party,date:f.date,amount:+f.amount,method:f.method,acct:f.acct,inv:f.inv,txn:f.txn.trim(),notes:f.notes.trim()});onClose();if(r.rec&&onSaved)onSaved(r.rec)};
return <Modal open={open} size="md" title={L.title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={done} onClick={save}>{L.save}</Button></>}>
<div className="sp-form-grid"><Field label={L.who} required error={e.party}><Select placeholder={"Choose "+L.who} value={f.party||""} onChange={x=>setF({...f,party:x.target.value,inv:""})} options={names}/></Field>
<Field label="Payment Date" required error={e.date}><Input type="date" value={f.date||""} onChange={x=>set("date")(x.target.value)}/></Field>
{f.party&&<div className="sp-span-all" style={{background:"var(--neutral-100)",borderRadius:"var(--radius-md)",padding:"12px 16px",display:"flex",justifyContent:"space-between",font:"400 14px/20px var(--font-body)"}}><span style={{color:"var(--text-2)"}}>{L.bal}</span><b style={{color:out>0?"var(--danger-500)":"var(--text-1)"}}>{egp(out)}</b></div>}
<Field label={L.amt} required error={e.amount} hint={sel?"Invoice balance: "+egp(sel.amt):undefined}><Input type="number" min="0" addon="EGP" placeholder="0.00" value={f.amount||""} onChange={x=>set("amount")(x.target.value)}/></Field>
<Field label="Payment Method"><Select value={f.method||"Cash"} onChange={x=>set("method")(x.target.value)} options={["Cash","Bank Transfer","Card","Cheque"]}/></Field>
<Field label={L.acct} required error={e.acct}><Select placeholder="Choose Account" value={f.acct||""} onChange={x=>set("acct")(x.target.value)} options={FIN.ACC.map(a=>({value:a.id,label:a.name+" · "+egp(FIN.balance(a.id))}))}/></Field>
<Field label={L.inv}><Select disabled={!f.party||!inv.length} value={f.inv||""} onChange={x=>set("inv")(x.target.value)} options={[{value:"",label:"None (unallocated)"},...inv.map(i=>({value:i.ref,label:i.ref+" · "+egp(i.amt)}))]}/></Field>
<Field label="Payment Reference"><Input placeholder="Enter Reference" value={f.txn||""} onChange={x=>set("txn")(x.target.value)}/></Field>
<Field label="Notes" className="sp-span-all"><Textarea placeholder="Enter Notes" value={f.notes||""} onChange={x=>set("notes")(x.target.value)}/></Field></div></Modal>}
Object.assign(window,{useFin,PaymentModal});
})();