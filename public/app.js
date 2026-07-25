
let data={settings:null,catalog:[],orders:[]}, editId=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Errore');return j}
$('#loginBtn').onclick=async()=>{try{await api('/api/login',{pin:$('#pin').value});$('#login').hidden=true;$('#app').hidden=false;await load()}catch(e){$('#loginErr').textContent=e.message}}
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{});location.reload()}
$$('nav button').forEach(b=>b.onclick=()=>{$$('nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.tab').forEach(x=>x.hidden=true);$('#tab-'+b.dataset.tab).hidden=false;render()})
function cat(kind){return data.catalog.filter(x=>x.kind===kind)}
function euro(n){return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(n||0))}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
async function load(){data=await api('/api/bootstrap');render()}
setInterval(()=>{if(!$('#app').hidden)load().catch(()=>{})},4000)
function orderLines(o){
 let h=(o.sandwiches||[]).map((s,i)=>`<div><b>${esc(s.name||'Panino '+(i+1))}</b>: ${esc((s.ingredient_names||[]).join(', '))}</div>`).join('');
 if((o.drinks||[]).length)h+=`<div class="muted">Bevande: ${(o.drinks||[]).map(d=>`${esc(d.name)} × ${d.qty}`).join(', ')}</div>`;
 return h;
}
function render(){
 if(!data.settings)return;
 $('#qrState').textContent=data.settings.qr_orders_enabled?'Richieste QR aperte':'Richieste QR chiuse';
 renderBanco();renderQr();renderCoda();renderStorico();renderSettings();
}
function renderBanco(){
 const ing=cat('ingredient').filter(x=>x.available), drinks=cat('drink').filter(x=>x.available);
 const edit=editId?data.orders.find(o=>o.id===editId):null;
 $('#tab-banco').innerHTML=`<div class="panel"><h2>${edit?'Modifica ordine':'Nuovo ordine'}</h2>
 <input id="cust" placeholder="Nome cliente obbligatorio" value="${esc(edit?.customer_name||'')}">
 <div id="sandwiches"></div><button id="addSw" class="secondary">+ Aggiungi panino</button>
 <h3>Bevande</h3><div class="chips" id="drinkChips">${drinks.map(d=>`<button class="chip" data-drink="${d.id}" data-name="${esc(d.name)}">${esc(d.name)} ${euro(d.price)}</button>`).join('')}</div>
 <div id="drinkSummary" class="muted"></div>
 <div class="sep"></div><div class="row"><select id="pay"><option value="unpaid">Da pagare</option><option value="paid">Pagato</option></select><input id="paidAmount" type="number" step=".5" placeholder="Importo incassato"></div>
 <select id="method"><option value="">Metodo pagamento</option><option>Contanti</option><option>Carta</option></select>
 <textarea id="notes" placeholder="Note">${esc(edit?.notes||'')}</textarea>
 <div class="row"><button id="save" class="success">${edit?'Salva modifiche':'Invia in coda'}</button>${edit?'<button id="cancelEdit" class="secondary">Annulla</button>':''}</div></div>`;
 let sws=edit?.sandwiches?.length?JSON.parse(JSON.stringify(edit.sandwiches)):[{name:'Panino 1',ingredient_ids:[],ingredient_names:[]}];
 let dr=edit?.drinks?JSON.parse(JSON.stringify(edit.drinks)):[];
 function drawS(){
   $('#sandwiches').innerHTML=sws.map((s,i)=>`<div class="order"><div class="row between"><b>Panino ${i+1}</b>${sws.length>1?`<button class="danger" data-del="${i}">Rimuovi</button>`:''}</div>
   <input data-swname="${i}" value="${esc(s.name||'Panino '+(i+1))}" placeholder="Nome panino">
   <div class="chips">${ing.map(x=>`<button class="chip ${(s.ingredient_ids||[]).includes(x.id)?'on':''}" data-i="${i}" data-ing="${x.id}">${esc(x.name)}</button>`).join('')}</div></div>`).join('');
   $$('[data-ing]').forEach(b=>b.onclick=()=>{let s=sws[+b.dataset.i],x=ing.find(i=>i.id===b.dataset.ing);s.ingredient_ids=s.ingredient_ids||[];s.ingredient_names=s.ingredient_names||[];if(s.ingredient_ids.includes(x.id)){s.ingredient_ids=s.ingredient_ids.filter(v=>v!==x.id);s.ingredient_names=s.ingredient_names.filter(v=>v!==x.name)}else{s.ingredient_ids.push(x.id);s.ingredient_names.push(x.name)}drawS()});
   $$('[data-swname]').forEach(i=>i.oninput=()=>sws[+i.dataset.swname].name=i.value);
   $$('[data-del]').forEach(b=>b.onclick=()=>{sws.splice(+b.dataset.del,1);drawS()});
 }
 function drawD(){ $('#drinkSummary').textContent=dr.length?dr.map(x=>`${x.name} × ${x.qty}`).join(' · '):'Nessuna bevanda';}
 drawS();drawD();
 $('#addSw').onclick=()=>{sws.push({name:'Panino '+(sws.length+1),ingredient_ids:[],ingredient_names:[]});drawS()}
 $$('[data-drink]').forEach(b=>b.onclick=()=>{let x=dr.find(d=>d.item_id===b.dataset.drink);if(x)x.qty++;else dr.push({item_id:b.dataset.drink,name:b.dataset.name,qty:1});drawD()})
 if(edit){$('#pay').value=edit.payment_status;$('#paidAmount').value=edit.paid_total??'';$('#method').value=edit.payment_method||'';$('#cancelEdit').onclick=()=>{editId=null;renderBanco()}}
 $('#save').onclick=async()=>{try{await api('/api/action',{action:edit?'update_order':'create_order',id:edit?.id,customer_name:$('#cust').value,sandwiches:sws,drinks:dr,payment_status:$('#pay').value,paid_total:$('#paidAmount').value||undefined,payment_method:$('#method').value,notes:$('#notes').value});editId=null;await load()}catch(e){alert(e.message)}}
}
function renderQr(){
 const arr=data.orders.filter(o=>o.status==='pending_approval');
 $('#tab-qr').innerHTML=`<h2>Richieste QR (${arr.length})</h2>`+(arr.length?arr.map(o=>`<div class="order"><div class="row between"><div><b class="big">${esc(o.customer_name)}</b><div class="muted">${new Date(o.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</div></div><b>${euro(o.original_total)}</b></div>${orderLines(o)}<div class="row"><button class="success" data-accept="${o.id}">Accetta</button><button class="danger" data-reject="${o.id}">Rifiuta</button></div></div>`).join(''):'<p>Nessuna richiesta.</p>');
 $$('[data-accept]').forEach(b=>b.onclick=()=>act('accept_qr',b.dataset.accept));
 $$('[data-reject]').forEach(b=>b.onclick=()=>act('reject_qr',b.dataset.reject));
}
function renderCoda(){
 const arr=data.orders.filter(o=>['preparing','queued'].includes(o.status)).sort((a,b)=>new Date(a.accepted_at||a.created_at)-new Date(b.accepted_at||b.created_at));
 $('#tab-coda').innerHTML=`<h2>Paninaro</h2>`+(arr.length?arr.map((o,i)=>`<div class="order ${o.status==='preparing'?'preparing':''}"><div class="row between"><b class="big">${i+1}. ${esc(o.customer_name)}</b><span class="badge">${o.status==='preparing'?'IN PREPARAZIONE':'IN CODA'}</span></div>${orderLines(o)}${o.status==='preparing'?`<button class="success" data-deliver="${o.id}">CONSEGNATO</button>`:''}</div>`).join(''):'<p>Nessun panino in coda.</p>');
 $$('[data-deliver]').forEach(b=>b.onclick=()=>act('deliver',b.dataset.deliver));
}
function renderStorico(){
 const arr=data.orders.filter(o=>['delivered','rejected'].includes(o.status));
 $('#tab-storico').innerHTML=`<h2>Storico</h2>`+arr.map(o=>`<div class="order"><div class="row between"><div><b>${esc(o.customer_name)}</b> · ${o.status}</div><b>${euro(o.original_total)}</b></div>${orderLines(o)}<div class="muted">Pagato: ${o.payment_status==='paid'?euro(o.paid_total):'NO'} · Sconto: ${euro(o.discount)}</div><div class="row"><button class="secondary" data-edit="${o.id}">Modifica</button><button class="danger" data-delete="${o.id}">Elimina</button></div></div>`).join('');
 $$('[data-edit]').forEach(b=>b.onclick=()=>{editId=b.dataset.edit;$$('nav button').find(x=>x.dataset.tab==='banco').click()});
 $$('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm('Eliminare definitivamente?'))act('delete_order',b.dataset.delete)});
}
function renderSettings(){
 $('#tab-impostazioni').innerHTML=`<div class="panel"><h2>Impostazioni</h2><div class="row between"><div><b>Richieste panini tramite QR</b><div class="muted">Il menu resta sempre visibile.</div></div><button id="toggleQr" class="${data.settings.qr_orders_enabled?'danger':'success'}">${data.settings.qr_orders_enabled?'Blocca richieste':'Apri richieste'}</button></div></div>
 <h2>Disponibilità prodotti</h2><div class="grid">${data.catalog.map(x=>`<div class="order row between"><div><b>${esc(x.name)}</b><div class="muted">${esc(x.kind)} · ${esc(x.category)}</div></div><button data-av="${x.id}" data-val="${!x.available}" class="${x.available?'success':'secondary'}">${x.available?'Disponibile':'Bloccato'}</button></div>`).join('')}</div>`;
 $('#toggleQr').onclick=()=>act('toggle_qr',null,{enabled:!data.settings.qr_orders_enabled});
 $$('[data-av]').forEach(b=>b.onclick=()=>act('set_availability',null,{id:b.dataset.av,available:b.dataset.val==='true'}));
}
async function act(action,id,extra={}){try{await api('/api/action',{action,id,...extra});await load()}catch(e){alert(e.message)}}
