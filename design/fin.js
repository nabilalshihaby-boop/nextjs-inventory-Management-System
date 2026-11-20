(()=>{
const K="sp.fin.v1";
try{const n=performance.getEntriesByType("navigation")[0];if(n&&n.type==="reload")sessionStorage.removeItem(K)}catch(e){}
let st;try{st=JSON.parse(sessionStorage.getItem(K))}catch(e){}if(!st||!Array.isArray(st.payments))st={payments:[],n:{c:0,s:0}};
const save=()=>{try{sessionStorage.setItem(K,JSON.stringify(st))}catch(e){}window.dispatchEvent(new Event("sp-fin"))};
const A=window.AGING,sum=a=>a.reduce((s,x)=>s+x,0);
const ACC=[{id:"a1",name:"Main Cash Register",type:"Cash",bal:45000},{id:"a2",name:"POS Cash Drawer",type:"Cash",bal:18250},{id:"a3",name:"Branch Cash Register",type:"Cash",bal:22500},{id:"a4",name:"CIB Business Account",type:"Bank",bal:210000},{id:"a5",name:"Banque Misr Account",type:"Bank",bal:114500}];
const bucket=d=>d<=0?0:d<=30?1:d<=60?2:d<=90?3:4;
const dsup=()=>window.DEMO?window.DEMO.get().suppliers:[];
const FIN={ACC,A,get:()=>st,
list:kind=>st.payments.filter(p=>p.kind===kind),
add(p){if(st.payments.some(x=>x.id===p.id))return{dup:true};if(p.inv){const iv=FIN.openInvoices(p.kind,p.party).find(i=>i.ref===p.inv);if(!iv||+p.amount>iv.amt)return{error:"Exceeds the invoice balance"}}const k=p.kind==="customer"?"c":"s";st.n[k]++;const ref=(k==="c"?"COL":"PAY")+"-2026-"+String(st.n[k]).padStart(3,"0");const d=new Date();const rec={...p,ref,amount:+p.amount,time:String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};st.payments=[...st.payments,rec];save();return{rec}},
remove(id){st.payments=st.payments.filter(p=>p.id!==id);save()},
delta:id=>sum(st.payments.filter(p=>p.acct===id).map(p=>p.kind==="customer"?p.amount:-p.amount)),
balance:id=>ACC.find(a=>a.id===id).bal+FIN.delta(id),
accName:id=>(ACC.find(a=>a.id===id)||{name:"—"}).name,
collected:()=>sum(FIN.list("customer").map(p=>p.amount)),
allocOf:(no,asOf)=>sum(st.payments.filter(p=>p.inv===no&&(!asOf||p.date<=asOf)).map(p=>p.amount)),
aging(kind,asOf){const list=kind==="customer"?A.CUS_AG:A.SUP_AG;return list.map(e=>{const invs=e.invs.filter(i=>i.date<=asOf).map(i=>{const al=FIN.allocOf(i.no,asOf);const out=Math.max(0,i.out-al);const days=A.diff(asOf,i.due);return{...i,paid:i.paid+(i.out-out),out,days:Math.max(0,days),b:bucket(days)}}).filter(i=>i.out>0);const bk=[0,0,0,0,0];invs.forEach(i=>bk[i.b]+=i.out);const tot=sum(bk);const credit=sum(st.payments.filter(p=>p.kind===kind&&p.party===e.name&&!p.inv&&p.date<=asOf).map(p=>p.amount));return{...e,invs,bk,tot,over:tot-bk[0],credit}}).filter(e=>e.tot>0)},
openInvoices(kind,name){const e=FIN.aging(kind,A.BASE).find(x=>x.name===name);return e?[...e.invs].sort((a,b)=>a.due.localeCompare(b.due)).map(i=>({ref:i.no,amt:i.out,due:i.due})):[]},
parties(kind){if(kind==="customer")return window.CUSTOMERS.map(c=>c.name);const s=A.SUP_AG.map(x=>x.name);dsup().forEach(x=>{if(!s.includes(x.name))s.push(x.name)});return s},
suppTx(name){const ds=dsup().find(x=>x.name===name);let seed;if(ds&&window.DEMO)seed=window.DEMO.txns(ds.id);else{const e=A.SUP_AG.find(x=>x.name===name);seed=[];if(e)e.invs.forEach(v=>{seed.push({date:v.date,ref:v.no,type:"Purchase",desc:"Purchase invoice",debit:0,credit:v.amount,o:0});if(v.paid>0)seed.push({date:A.add(v.date,10)>A.BASE?A.BASE:A.add(v.date,10),ref:"PY_"+(3300+seed.length),type:"Payment",desc:"Payment · Cash",debit:v.paid,credit:0,o:1})})}
const dm=FIN.list("supplier").filter(p=>p.party===name).map(p=>({date:p.date,ref:p.ref,type:"Payment",desc:"Payment · "+p.method+(p.inv?" · applied to "+p.inv:" · Unallocated")+(p.notes?" · "+p.notes:""),debit:p.amount,credit:0,o:1,demo:true}));return[...seed,...dm].sort((a,b)=>a.date.localeCompare(b.date)||(a.o||0)-(b.o||0)||String(a.ref).localeCompare(String(b.ref)))},
outstanding(kind,name){if(kind==="customer"){const c=window.CUSTOMERS.find(x=>x.name===name);return c?window.custTotals(c).out-sum(FIN.list("customer").filter(p=>p.party===name).map(p=>p.amount)):0}const t=FIN.suppTx(name);return sum(t.map(x=>x.credit-x.debit))},
partyInfo(kind){return FIN.parties(kind).map(n=>({id:n,name:n,out:FIN.outstanding(kind,n),invs:FIN.openInvoices(kind,n).map(i=>({ref:i.ref,amt:i.amt}))}))},
cashTx(){return st.payments.map(p=>({id:p.id,ts:p.date+" "+(p.time||"12:00"),acct:p.acct,kind:p.kind==="customer"?"D":"W",desc:(p.kind==="customer"?"Customer Collection — ":"Supplier Payment — ")+p.party,amount:p.amount,method:p.method,purpose:p.kind==="customer"?"Customer Collection":"Supplier Payment",to:"",ref:p.ref,status:"Completed",notes:p.notes||"",party:p.party,inv:p.inv||"",demo:true}))}};
window.FIN=FIN;
})();