(()=>{
const K="sp.demo.v1";
try{const n=performance.getEntriesByType("navigation")[0];if(n&&n.type==="reload")sessionStorage.removeItem(K)}catch(e){}
const P=[["PU_1119","s1",4930,"12:25 AM","2026-05-27"],["PU_1118","s1",2220,"11:58 PM","2024-02-03"],["PU_1117","s1",162000,"11:50 PM","2024-02-03"],["PU_1116","s1",45000,"11:42 PM","2024-02-03"],["PU_1115","s1",49300,"11:23 PM","2024-02-03"],["PU_1114","s1",64350,"11:15 PM","2024-02-03"],["PU_1113","s1",30260,"11:12 PM","2024-02-03"],["PU_1112","s1",1620,"11:02 PM","2024-02-03"],["PU_1111","s1",95000,"11:08 PM","2024-02-02"],["PU_1120","s2",12000,"10:10 AM","2026-05-20"]].map(r=>({ref:r[0],sup:r[1],total:r[2],at:r[3],date:r[4]}));
const seed=()=>({n:2003,suppliers:[{id:"s1",name:"China",email:"china@gmail.com",phone:"0155555",at:"6:16 AM · 02/02/2024"},{id:"s2",name:"Local Supplier",email:"local@supplier.com",phone:"0122222",at:"9:00 AM · 15/03/2024"}],purchases:P,
payments:[{id:"y1",ref:"PY_2001",date:"2026-05-04",sup:"s1",method:"Cash",amount:40000,txn:"",notes:"",alloc:[{inv:"PU_1111",amt:40000}]},{id:"y2",ref:"PY_2002",date:"2026-05-18",sup:"s1",method:"Bank Transfer",amount:50000,txn:"TRX-88231",notes:"Second instalment",alloc:[{inv:"PU_1111",amt:50000}]},{id:"y3",ref:"PY_2003",date:"2026-05-27",sup:"s1",method:"Cash",amount:30000,txn:"",notes:"Advance payment",alloc:[]}]});
let db;try{db=JSON.parse(sessionStorage.getItem(K))}catch(e){}if(!db)db=seed();
const save=()=>{try{sessionStorage.setItem(K,JSON.stringify(db))}catch(e){}window.dispatchEvent(new Event("sp-demo"))};
const sum=a=>a.reduce((s,x)=>s+x,0);
const D={get:()=>db,
egp:n=>"EGP "+(+n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),
supplier:id=>db.suppliers.find(s=>s.id===id),supName:id=>(D.supplier(id)||{name:"—"}).name,
today:()=>new Date().toISOString().slice(0,10),
addSupplier(f){const id="s"+Date.now().toString(36);const d=new Date();const s={id,name:f.name.trim(),email:f.email.trim(),phone:f.phone.trim(),at:d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})+" · "+d.toLocaleDateString("en-GB")};db.suppliers=[s,...db.suppliers];save();return s},
paidOn(ref,skip){return sum(db.payments.filter(p=>p.id!==skip).flatMap(p=>p.alloc).filter(a=>a.inv===ref).map(a=>a.amt))},
invoice(i,skip){const paid=D.paidOn(i.ref,skip),due=Math.max(0,i.total-paid);return{...i,paid,due,status:paid<=0?"Unpaid":due<=0?"Paid":"Partial"}},
invoices(sup,skip){return db.purchases.filter(p=>!sup||p.sup===sup).map(p=>D.invoice(p,skip))},
payStatus(p){const a=sum(p.alloc.map(x=>x.amt));return a<=0?"Unallocated":a>=p.amount?"Applied":"Partially Applied"},
allocate(sup,amount,refs,skip){let left=amount;const out=[];D.invoices(sup,skip).filter(i=>refs.includes(i.ref)&&i.due>0).sort((a,b)=>a.date.localeCompare(b.date)).forEach(i=>{const a=Math.min(left,i.due);if(a>0){out.push({inv:i.ref,amt:a});left-=a}});return out},
savePayment(f,id){const alloc=D.allocate(f.sup,+f.amount,f.refs||[],id);const rec={date:f.date,sup:f.sup,method:f.method,amount:+f.amount,txn:f.txn,notes:f.notes,alloc};
if(id){db.payments=db.payments.map(p=>p.id===id?{...p,...rec}:p)}else{db.n+=1;db.payments=[{id:"y"+db.n,ref:"PY_"+db.n,...rec},...db.payments]}save();return rec},
deletePayment(id){db.payments=db.payments.filter(p=>p.id!==id);save()},
txns(sup){const t=[];db.purchases.filter(p=>p.sup===sup).forEach(p=>t.push({date:p.date,ref:p.ref,type:"Purchase",desc:"Purchase invoice",debit:0,credit:p.total,o:0}));
db.payments.filter(p=>p.sup===sup).forEach(p=>t.push({date:p.date,ref:p.ref,type:"Payment",desc:p.method+(p.alloc.length?" · applied to "+p.alloc.map(a=>a.inv).join(", "):" · unallocated")+(p.notes?" · "+p.notes:""),debit:p.amount,credit:0,o:1}));
return t.sort((a,b)=>a.date.localeCompare(b.date)||a.o-b.o||a.ref.localeCompare(b.ref))},
flash:m=>{try{sessionStorage.setItem("sp.flash",m)}catch(e){}},
takeFlash(){try{const m=sessionStorage.getItem("sp.flash");sessionStorage.removeItem("sp.flash");return m}catch(e){return null}}};
window.DEMO=D;
})();
