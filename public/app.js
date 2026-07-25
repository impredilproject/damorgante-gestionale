let data={settings:null,catalog:[],orders:[]};
let editId=null;
let catalogEditId=null;
let currentTab='banco';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

function emptyDraft(){
  return {
    customer_name:'',
    sandwiches:[{name:'Panino 1',ingredient_ids:[],ingredient_names:[]}],
    sides:[],
    drinks:[],
    payment_status:'unpaid',
    paid_total:'',
    payment_method:'',
    notes:''
  };
}

let draft=emptyDraft();

async function api(url,body){
  const response=await fetch(url,{
    method:body?'POST':'GET',
    headers:{'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(json.error||'Errore');
  return json;
}

$('#loginBtn').onclick=async()=>{
  try{
    await api('/api/login',{pin:$('#pin').value});
    $('#login').hidden=true;
    $('#app').hidden=false;
    await load();
  }catch(error){
    $('#loginErr').textContent=error.message;
  }
};

$('#logoutBtn').onclick=async()=>{
  await api('/api/logout',{});
  location.reload();
};

$$('nav button').forEach(button=>{
  button.onclick=()=>{
    currentTab=button.dataset.tab;
    $$('nav button').forEach(item=>item.classList.remove('active'));
    button.classList.add('active');
    $$('.tab').forEach(section=>section.hidden=true);
    $('#tab-'+currentTab).hidden=false;
    render();
  };
});

function cat(kind){
  return data.catalog.filter(item=>item.kind===kind);
}

function euro(value){
  return new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'})
    .format(Number(value||0));
}

function esc(value){
  return String(value??'').replace(/[&<>"']/g,char=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function ingredientWeight(item){
  if(!item || item.kind!=='ingredient') return 0;
  const weight=Number(item.sandwich_price_weight);
  if(Number.isFinite(weight) && weight>0) return weight;
  return item.counts_for_sandwich_price?1:0.5;
}

function sandwichPrice(sw){
  const ids=[...new Set(sw.ingredient_ids||[])];
  const count=ids.reduce((sum,id)=>sum+ingredientWeight(data.catalog.find(item=>item.id===id)),0);
  if(count<=0) return 0;
  if(count<=2) return 5;
  if(count<=3) return 6;
  return 7;
}

function draftTotal(){
  const sandwichTotal=(draft.sandwiches||[]).reduce((sum,sw)=>sum+sandwichPrice(sw),0);
  const sideTotal=(draft.sides||[]).reduce((sum,side)=>{
    const item=data.catalog.find(x=>x.id===side.item_id);
    return sum+Number(item?.price||0)*Number(side.qty||0);
  },0);
  const drinkTotal=(draft.drinks||[]).reduce((sum,drink)=>{
    const item=data.catalog.find(x=>x.id===drink.item_id);
    return sum+Number(item?.price||0)*Number(drink.qty||0);
  },0);
  return sandwichTotal+sideTotal+drinkTotal;
}

async function load(){
  data=await api('/api/bootstrap');
  render();
}

setInterval(()=>{
  const tag=document.activeElement?.tagName;
  if(!$('#app').hidden && !['INPUT','TEXTAREA','SELECT'].includes(tag)){
    load().catch(()=>{});
  }
},4000);

function orderLines(order,includeDrinks=true){
  let html=(order.sandwiches||[]).map((sw,index)=>`
    <div class="order-line">
      <b>Panino ${index+1}</b>
      <span>${esc((sw.ingredient_names||[]).join(', ')||'Nessun ingrediente')}</span>
    </div>`).join('');

  if((order.sides||[]).length){
    html+=`<div class="order-line sides-line"><b>Patatine</b><span>${
      order.sides.map(side=>`${esc(side.name)} × ${side.qty}`).join(', ')
    }</span></div>`;
  }

  if(includeDrinks && (order.drinks||[]).length){
    html+=`<div class="order-line drinks-line"><b>Bevande</b><span>${
      order.drinks.map(drink=>`${esc(drink.name)} × ${drink.qty}`).join(', ')
    }</span></div>`;
  }

  if(!includeDrinks && !(order.sandwiches||[]).length && !(order.sides||[]).length && (order.drinks||[]).length){
    html+='<div class="order-line drinks-line"><b>Solo bevande</b><span>Preparazione e consegna al banco</span></div>';
  }else if(!includeDrinks && (order.drinks||[]).length){
    html+='<div class="muted small-note">Sono presenti anche bevande da gestire al banco.</div>';
  }

  return html;
}

function pendingOrders(){
  return data.orders
    .filter(order=>order.status==='pending_approval')
    .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
}

function pendingCardsHtml(context){
  const orders=pendingOrders();
  if(!orders.length) return '<p class="empty-state">Nessuna richiesta QR in attesa.</p>';

  return orders.map(order=>{
    const mustPay=order.payment_required_before_acceptance;
    return `
      <article class="order pending-card">
        <div class="row between">
          <div>
            <span class="source-badge">QR</span>
            <b class="big">${esc(order.customer_name)}</b>
            <div class="muted">${new Date(order.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          <div class="right">
            <b class="total-small">${euro(order.original_total)}</b>
            <span class="badge ${mustPay?'badge-warn':'badge-ok'}">${mustPay?'Pagamento prima':'Pagamento anche dopo'}</span>
          </div>
        </div>

        <div class="order-content">${orderLines(order,context==='banco')}</div>

        <div class="accept-box">
          <select data-pay-method="${context}-${order.id}">
            <option value="">Metodo di pagamento</option>
            <option value="Contanti">Contanti</option>
            <option value="Carta">Carta</option>
          </select>

          <div class="row">
            ${mustPay?'':`<button class="success" data-accept-unpaid="${context}-${order.id}">Accetta da pagare</button>`}
            <button class="primary" data-accept-paid="${context}-${order.id}">Pagato e accetta</button>
            <button class="danger" data-reject="${context}-${order.id}">Rifiuta</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function bindPendingActions(context){
  $$(`[data-accept-unpaid^="${context}-"]`).forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.acceptUnpaid.slice(context.length+1);
      act('accept_qr',id,{mark_paid:false});
    };
  });

  $$(`[data-accept-paid^="${context}-"]`).forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.acceptPaid.slice(context.length+1);
      const method=$(`[data-pay-method="${context}-${id}"]`).value;
      if(!method){
        alert('Seleziona il metodo di pagamento.');
        return;
      }
      act('accept_qr',id,{mark_paid:true,payment_method:method});
    };
  });

  $$(`[data-reject^="${context}-"]`).forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.reject.slice(context.length+1);
      if(confirm('Rifiutare questa richiesta QR?')) act('reject_qr',id);
    };
  });
}

function render(){
  if(!data.settings) return;

  const pendingCount=pendingOrders().length;
  const paymentText=data.settings.qr_payment_before_acceptance
    ? 'Pagamento richiesto prima dell’accettazione'
    : 'Pagamento consentito anche dopo';

  $('#qrState').textContent=
    `${data.settings.qr_orders_enabled?'QR aperto':'QR chiuso'} · ${paymentText}`+
    (pendingCount?` · ${pendingCount} in attesa`:'');

  renderBanco();
  renderCoda();
  renderStorico();
  renderSettings();
}

function renderBanco(){
  const ingredients=cat('ingredient').filter(item=>item.available);
  const sideItems=cat('side').filter(item=>item.available);
  const drinkItems=cat('drink').filter(item=>item.available);
  const editing=editId?data.orders.find(order=>order.id===editId):null;

  $('#tab-banco').innerHTML=`
    <section class="section-block">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Arrivate dal sito</span>
          <h2>Richieste QR (${pendingOrders().length})</h2>
        </div>
      </div>
      ${pendingCardsHtml('banco')}
    </section>

    <section class="panel">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Inserimento rapido</span>
          <h2>${editing?'Modifica ordine':'Nuovo ordine dal banco'}</h2>
        </div>
        <b class="draft-total">${euro(draftTotal())}</b>
      </div>

      <input id="cust" placeholder="Nome cliente obbligatorio" value="${esc(draft.customer_name)}">
      <div id="sandwiches"></div>
      <button id="addSw" class="secondary full">+ Aggiungi panino</button>

      <h3>Porzioni di patatine</h3>
      <div class="drink-picker side-picker">
        ${sideItems.map(item=>{
          const selected=draft.sides.find(side=>side.item_id===item.id);
          const qty=Number(selected?.qty||0);
          return `
            <div class="drink-pick-row">
              <div><b>${esc(item.name)}</b><span>${euro(item.price)} a porzione</span></div>
              <div class="qty">
                <button data-draft-side-minus="${item.id}" ${qty===0?'disabled':''}>−</button>
                <output>${qty}</output>
                <button data-draft-side-plus="${item.id}">+</button>
              </div>
            </div>`;
        }).join('')||'<p>Nessuna porzione disponibile.</p>'}
      </div>

      <h3>Bevande</h3>
      <div class="drink-picker">
        ${drinkItems.map(item=>{
          const selected=draft.drinks.find(drink=>drink.item_id===item.id);
          const qty=Number(selected?.qty||0);
          return `
            <div class="drink-pick-row">
              <div><b>${esc(item.name)}</b><span>${euro(item.price)}</span></div>
              <div class="qty">
                <button data-draft-drink-minus="${item.id}" ${qty===0?'disabled':''}>−</button>
                <output>${qty}</output>
                <button data-draft-drink-plus="${item.id}">+</button>
              </div>
            </div>`;
        }).join('')||'<p>Nessuna bevanda disponibile.</p>'}
      </div>

      <div class="sep"></div>
      <div class="grid two">
        <select id="pay">
          <option value="unpaid">Da pagare</option>
          <option value="paid">Pagato</option>
        </select>
        <input id="paidAmount" type="number" min="0" step=".50" placeholder="Importo incassato" value="${esc(draft.paid_total)}">
      </div>

      <select id="method">
        <option value="">Metodo pagamento</option>
        <option value="Contanti" ${draft.payment_method==='Contanti'?'selected':''}>Contanti</option>
        <option value="Carta" ${draft.payment_method==='Carta'?'selected':''}>Carta</option>
      </select>

      <textarea id="notes" placeholder="Note">${esc(draft.notes)}</textarea>

      <div class="row">
        <button id="save" class="success">${editing?'Salva modifiche':'Invia in coda'}</button>
        ${editing?'<button id="cancelEdit" class="secondary">Annulla modifica</button>':''}
      </div>
    </section>

    <section class="section-block">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Cassa</span>
          <h2>Da incassare</h2>
        </div>
      </div>
      ${unpaidCardsHtml()}
    </section>`;

  bindPendingActions('banco');
  bindBancoForm(ingredients,editing);
  bindUnpaidActions();
}

function bindBancoForm(ingredients,editing){
  function drawSandwiches(){
    $('#sandwiches').innerHTML=draft.sandwiches.map((sw,index)=>`
      <article class="order sandwich-edit">
        <div class="row between">
          <b>Panino ${index+1}</b>
          <div class="row">
            <span class="badge">${euro(sandwichPrice(sw))}</span>
            ${draft.sandwiches.length>1?`<button class="danger small" data-delete-sw="${index}">Rimuovi</button>`:''}
          </div>
        </div>
        <div class="chips">
          ${ingredients.map(item=>`
            <button class="chip ${(sw.ingredient_ids||[]).includes(item.id)?'on':''}"
              data-sw-index="${index}" data-ingredient-id="${item.id}">
              ${esc(item.name)}${ingredientWeight(item)===0.5?' ½':''}
            </button>`).join('')}
        </div>
      </article>`).join('');

    $$('[data-ingredient-id]').forEach(button=>{
      button.onclick=()=>{
        syncDraftFields();
        const sw=draft.sandwiches[Number(button.dataset.swIndex)];
        const item=ingredients.find(x=>x.id===button.dataset.ingredientId);
        sw.ingredient_ids=sw.ingredient_ids||[];
        sw.ingredient_names=sw.ingredient_names||[];

        if(sw.ingredient_ids.includes(item.id)){
          sw.ingredient_ids=sw.ingredient_ids.filter(id=>id!==item.id);
          sw.ingredient_names=sw.ingredient_names.filter(name=>name!==item.name);
        }else{
          sw.ingredient_ids.push(item.id);
          sw.ingredient_names.push(item.name);
        }
        renderBanco();
      };
    });

    $$('[data-delete-sw]').forEach(button=>{
      button.onclick=()=>{
        syncDraftFields();
        draft.sandwiches.splice(Number(button.dataset.deleteSw),1);
        if(!draft.sandwiches.length) draft.sandwiches=[{name:'Panino 1',ingredient_ids:[],ingredient_names:[]}];
        draft.sandwiches.forEach((sw,index)=>sw.name=`Panino ${index+1}`);
        renderBanco();
      };
    });
  }

  function syncDraftFields(){
    draft.customer_name=$('#cust')?.value??draft.customer_name;
    draft.payment_status=$('#pay')?.value??draft.payment_status;
    draft.paid_total=$('#paidAmount')?.value??draft.paid_total;
    draft.payment_method=$('#method')?.value??draft.payment_method;
    draft.notes=$('#notes')?.value??draft.notes;
  }

  drawSandwiches();

  $('#cust').oninput=event=>draft.customer_name=event.target.value;
  $('#pay').value=draft.payment_status;
  $('#pay').onchange=event=>draft.payment_status=event.target.value;
  $('#paidAmount').oninput=event=>draft.paid_total=event.target.value;
  $('#method').onchange=event=>draft.payment_method=event.target.value;
  $('#notes').oninput=event=>draft.notes=event.target.value;

  $('#addSw').onclick=()=>{
    syncDraftFields();
    draft.sandwiches.push({
      name:`Panino ${draft.sandwiches.length+1}`,
      ingredient_ids:[],
      ingredient_names:[]
    });
    renderBanco();
  };

  $$('[data-draft-side-plus]').forEach(button=>{
    button.onclick=()=>{
      syncDraftFields();
      const item=data.catalog.find(x=>x.id===button.dataset.draftSidePlus);
      const selected=draft.sides.find(x=>x.item_id===item.id);
      if(selected) selected.qty++;
      else draft.sides.push({item_id:item.id,name:item.name,qty:1});
      renderBanco();
    };
  });

  $$('[data-draft-side-minus]').forEach(button=>{
    button.onclick=()=>{
      syncDraftFields();
      const selected=draft.sides.find(x=>x.item_id===button.dataset.draftSideMinus);
      if(!selected) return;
      selected.qty=Math.max(0,Number(selected.qty)-1);
      draft.sides=draft.sides.filter(x=>x.qty>0);
      renderBanco();
    };
  });

  $$('[data-draft-drink-plus]').forEach(button=>{
    button.onclick=()=>{
      syncDraftFields();
      const item=data.catalog.find(x=>x.id===button.dataset.draftDrinkPlus);
      const selected=draft.drinks.find(x=>x.item_id===item.id);
      if(selected) selected.qty++;
      else draft.drinks.push({item_id:item.id,name:item.name,qty:1});
      renderBanco();
    };
  });

  $$('[data-draft-drink-minus]').forEach(button=>{
    button.onclick=()=>{
      syncDraftFields();
      const selected=draft.drinks.find(x=>x.item_id===button.dataset.draftDrinkMinus);
      if(!selected) return;
      selected.qty=Math.max(0,Number(selected.qty)-1);
      draft.drinks=draft.drinks.filter(x=>x.qty>0);
      renderBanco();
    };
  });

  if(editing){
    $('#cancelEdit').onclick=()=>{
      editId=null;
      draft=emptyDraft();
      renderBanco();
    };
  }

  $('#save').onclick=async()=>{
    syncDraftFields();

    const sandwiches=draft.sandwiches
      .filter(sw=>(sw.ingredient_ids||[]).length>0)
      .map((sw,index)=>({...sw,name:`Panino ${index+1}`}));

    const sides=draft.sides.filter(item=>Number(item.qty)>0);
    const drinks=draft.drinks.filter(item=>Number(item.qty)>0);

    if(!draft.customer_name.trim()){
      alert('Il nome cliente è obbligatorio.');
      return;
    }

    if(!sandwiches.length && !sides.length && !drinks.length){
      alert('Aggiungi almeno un ingrediente o una bevanda.');
      return;
    }

    if(draft.payment_status==='paid' && !draft.payment_method){
      alert('Seleziona il metodo di pagamento.');
      return;
    }

    try{
      await api('/api/action',{
        action:editing?'update_order':'create_order',
        id:editing?.id,
        customer_name:draft.customer_name,
        sandwiches,
        sides,
        drinks,
        payment_status:draft.payment_status,
        paid_total:draft.paid_total||undefined,
        payment_method:draft.payment_method,
        notes:draft.notes
      });
      editId=null;
      draft=emptyDraft();
      await load();
    }catch(error){
      alert(error.message);
    }
  };
}

function unpaidCardsHtml(){
  const orders=data.orders
    .filter(order=>order.payment_status==='unpaid' && !['rejected','pending_approval'].includes(order.status))
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));

  if(!orders.length) return '<p class="empty-state">Nessun pagamento in sospeso.</p>';

  return orders.map(order=>`
    <article class="order payment-card">
      <div class="row between">
        <div>
          <b class="big">${esc(order.customer_name)}</b>
          <span class="badge">${esc(order.status)}</span>
        </div>
        <b class="total-small">${euro(order.original_total)}</b>
      </div>
      ${orderLines(order,true)}
      <div class="grid pay-grid">
        <select data-unpaid-method="${order.id}">
          <option value="">Metodo</option>
          <option value="Contanti">Contanti</option>
          <option value="Carta">Carta</option>
        </select>
        <input data-unpaid-amount="${order.id}" type="number" min="0" step=".50" value="${Number(order.original_total)}">
        <button class="success" data-mark-paid="${order.id}">Registra pagamento</button>
      </div>
    </article>`).join('');
}

function bindUnpaidActions(){
  $$('[data-mark-paid]').forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.markPaid;
      const method=$(`[data-unpaid-method="${id}"]`).value;
      const paidTotal=$(`[data-unpaid-amount="${id}"]`).value;

      if(!method){
        alert('Seleziona il metodo di pagamento.');
        return;
      }

      act('mark_paid',id,{payment_method:method,paid_total:paidTotal});
    };
  });
}

function renderCoda(){
  const queue=data.orders
    .filter(order=>['preparing','queued'].includes(order.status))
    .sort((a,b)=>new Date(a.accepted_at||a.created_at)-new Date(b.accepted_at||b.created_at));

  $('#tab-coda').innerHTML=`
    <section class="section-block">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Arrivate dal sito</span>
          <h2>Richieste QR (${pendingOrders().length})</h2>
        </div>
      </div>
      ${pendingCardsHtml('paninaro')}
    </section>

    <section class="section-block">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Produzione</span>
          <h2>Coda panini</h2>
        </div>
      </div>
      ${queue.length?queue.map((order,index)=>`
        <article class="order ${order.status==='preparing'?'preparing':''}">
          <div class="row between">
            <b class="big">${index+1}. ${esc(order.customer_name)}</b>
            <div class="right">
              <span class="badge">${order.status==='preparing'?'IN PREPARAZIONE':'IN CODA'}</span>
              <span class="badge ${order.payment_status==='paid'?'badge-ok':'badge-warn'}">${order.payment_status==='paid'?'PAGATO':'DA PAGARE'}</span>
            </div>
          </div>
          <div class="order-content">${orderLines(order,false)}</div>
          ${order.status==='preparing'?`<button class="success full" data-deliver="${order.id}">CONSEGNATO</button>`:''}
        </article>`).join(''):'<p class="empty-state">Nessun panino in coda.</p>'}
    </section>`;

  bindPendingActions('paninaro');
  $$('[data-deliver]').forEach(button=>button.onclick=()=>act('deliver',button.dataset.deliver));
}

function renderStorico(){
  const orders=data.orders.filter(order=>['delivered','rejected'].includes(order.status));

  $('#tab-storico').innerHTML=`
    <div class="section-heading">
      <div>
        <span class="eyebrow">Archivio</span>
        <h2>Storico</h2>
      </div>
    </div>
    ${orders.length?orders.map(order=>`
      <article class="order">
        <div class="row between">
          <div>
            <b class="big">${esc(order.customer_name)}</b>
            <span class="badge">${order.status==='delivered'?'Consegnato':'Rifiutato'}</span>
          </div>
          <b>${euro(order.original_total)}</b>
        </div>
        ${orderLines(order,true)}
        <div class="muted">
          Pagamento: ${order.payment_status==='paid'
            ? `${euro(order.paid_total)} · ${esc(order.payment_method||'Metodo non indicato')}`
            : 'DA PAGARE'}
          · Sconto: ${euro(order.discount)}
        </div>
        <div class="row">
          <button class="secondary" data-edit="${order.id}">Modifica</button>
          <button class="danger" data-delete="${order.id}">Elimina</button>
        </div>
      </article>`).join(''):'<p class="empty-state">Nessun ordine nello storico.</p>'}`;

  $$('[data-edit]').forEach(button=>{
    button.onclick=()=>{
      const order=data.orders.find(item=>item.id===button.dataset.edit);
      editId=order.id;
      draft={
        customer_name:order.customer_name||'',
        sandwiches:(order.sandwiches||[]).length
          ? JSON.parse(JSON.stringify(order.sandwiches))
          : [{name:'Panino 1',ingredient_ids:[],ingredient_names:[]}],
        sides:JSON.parse(JSON.stringify(order.sides||[])),
        drinks:JSON.parse(JSON.stringify(order.drinks||[])),
        payment_status:order.payment_status||'unpaid',
        paid_total:order.paid_total??'',
        payment_method:order.payment_method||'',
        notes:order.notes||''
      };
      $$('nav button').find(item=>item.dataset.tab==='banco').click();
    };
  });

  $$('[data-delete]').forEach(button=>{
    button.onclick=()=>{
      if(confirm('Eliminare definitivamente questo ordine?')){
        act('delete_order',button.dataset.delete);
      }
    };
  });
}

function renderSettings(){
  const editing=catalogEditId?data.catalog.find(item=>item.id===catalogEditId):null;
  const ingredients=data.catalog.filter(item=>item.kind==='ingredient');
  const sidesCatalog=data.catalog.filter(item=>item.kind==='side');
  const drinks=data.catalog.filter(item=>item.kind==='drink');

  $('#tab-impostazioni').innerHTML=`
    <section class="panel">
      <div class="setting-row">
        <div>
          <h2>Richieste tramite QR</h2>
          <p>Il menu pubblico resta sempre consultabile.</p>
        </div>
        <button id="toggleQr" class="${data.settings.qr_orders_enabled?'danger':'success'}">
          ${data.settings.qr_orders_enabled?'Blocca richieste':'Apri richieste'}
        </button>
      </div>

      <div class="sep"></div>

      <div class="setting-row">
        <div>
          <h2>Pagamento prima dell’accettazione</h2>
          <p>${data.settings.qr_payment_before_acceptance
            ? 'Attivo: il cliente vede che la richiesta sarà accettata dopo il pagamento.'
            : 'Disattivo: puoi accettare subito e registrare il pagamento in seguito.'}</p>
        </div>
        <button id="togglePaymentRule" class="${data.settings.qr_payment_before_acceptance?'warn':'success'}">
          ${data.settings.qr_payment_before_acceptance?'Consenti pagamento dopo':'Richiedi pagamento prima'}
        </button>
      </div>
    </section>

    <section class="panel" id="catalogForm">
      <div class="section-heading">
        <div>
          <span class="eyebrow">Catalogo Supabase</span>
          <h2>${editing?'Modifica prodotto':'Aggiungi prodotto'}</h2>
        </div>
      </div>

      <div class="grid two">
        <div>
          <label>Nome</label>
          <input id="catName" value="${esc(editing?.name||'')}" placeholder="Es. Provola o Coca-Cola">
        </div>
        <div>
          <label>Tipo</label>
          <select id="catKind">
            <option value="ingredient" ${editing?.kind!=='drink'?'selected':''}>Ingrediente</option>
            <option value="side" ${editing?.kind==='side'?'selected':''}>Porzione / contorno</option>
            <option value="drink" ${editing?.kind==='drink'?'selected':''}>Bevanda</option>
          </select>
        </div>
        <div>
          <label>Categoria</label>
          <input id="catCategory" value="${esc(editing?.category||'')}" placeholder="Carni, Salse, Birre...">
        </div>
        <div id="priceBox">
          <label>Prezzo prodotto</label>
          <input id="catPrice" type="number" min="0" step=".10" value="${editing?.kind==='drink'?Number(editing.price):''}">
        </div>
        <div id="weightBox">
          <label>Valore nel conteggio panino</label>
          <select id="catWeight">
            <option value="1" ${Number(editing?.sandwich_price_weight??1)===1?'selected':''}>1 ingrediente</option>
            <option value="0.5" ${Number(editing?.sandwich_price_weight)===0.5?'selected':''}>1/2 ingrediente (salsa)</option>
          </select>
        </div>
      </div>

      <label class="checkrow">
        <input id="catAvailable" type="checkbox" ${editing?editing.available?'checked':'':'checked'}>
        <span>Disponibile nel menu pubblico</span>
      </label>

      <div class="row">
        <button id="saveCatalog" class="success">${editing?'Salva modifiche':'Aggiungi'}</button>
        ${editing?'<button id="cancelCatalog" class="secondary">Annulla</button>':''}
      </div>
    </section>

    <h2>Ingredienti (${ingredients.length})</h2>
    <div class="grid cards-grid">
      ${ingredients.map(catalogCard).join('')||'<p>Nessun ingrediente.</p>'}
    </div>

    <h2>Porzioni e contorni (${sidesCatalog.length})</h2>
    <div class="grid cards-grid">
      ${sidesCatalog.map(catalogCard).join('')||'<p>Nessuna porzione.</p>'}
    </div>

    <h2>Bevande (${drinks.length})</h2>
    <div class="grid cards-grid">
      ${drinks.map(catalogCard).join('')||'<p>Nessuna bevanda.</p>'}
    </div>`;

  function catalogCard(item){
    const detail=item.kind!=='ingredient'
      ? `${esc(item.category)} · ${euro(item.price)}`
      : `${esc(item.category)} · ${ingredientWeight(item)===0.5?'1/2 ingrediente':'1 ingrediente'}`;

    return `
      <article class="order">
        <div class="row between">
          <div>
            <b class="big">${esc(item.name)}</b>
            <div class="muted">${detail}</div>
          </div>
          <span class="badge ${item.available?'badge-ok':'badge-warn'}">${item.available?'Disponibile':'Bloccato'}</span>
        </div>
        <div class="row">
          <button class="secondary" data-cat-edit="${item.id}">Modifica</button>
          <button data-availability="${item.id}" data-next="${!item.available}" class="${item.available?'warn':'success'}">
            ${item.available?'Blocca':'Sblocca'}
          </button>
          <button class="danger" data-cat-delete="${item.id}">Elimina</button>
        </div>
      </article>`;
  }

  const kindSelect=$('#catKind');

  function syncCatalogFields(){
    const isIngredient=kindSelect.value==='ingredient';
    $('#priceBox').style.display=isIngredient?'none':'block';
    $('#weightBox').style.display=isIngredient?'block':'none';
  }

  syncCatalogFields();
  kindSelect.onchange=syncCatalogFields;

  $('#toggleQr').onclick=()=>act('toggle_qr',null,{
    enabled:!data.settings.qr_orders_enabled
  });

  $('#togglePaymentRule').onclick=()=>act('toggle_payment_rule',null,{
    enabled:!data.settings.qr_payment_before_acceptance
  });

  $('#saveCatalog').onclick=async()=>{
    const kind=$('#catKind').value;

    try{
      await api('/api/action',{
        action:editing?'update_catalog_item':'create_catalog_item',
        id:editing?.id,
        name:$('#catName').value,
        kind,
        category:$('#catCategory').value,
        price:kind==='ingredient'?0:$('#catPrice').value,
        sandwich_price_weight:kind==='ingredient'?Number($('#catWeight').value):0,
        available:$('#catAvailable').checked
      });

      catalogEditId=null;
      await load();
    }catch(error){
      alert(error.message);
    }
  };

  if(editing){
    $('#cancelCatalog').onclick=()=>{
      catalogEditId=null;
      renderSettings();
    };
  }

  $$('[data-cat-edit]').forEach(button=>{
    button.onclick=()=>{
      catalogEditId=button.dataset.catEdit;
      renderSettings();
      $('#catalogForm')?.scrollIntoView({behavior:'smooth'});
    };
  });

  $$('[data-availability]').forEach(button=>{
    button.onclick=()=>act('set_availability',null,{
      id:button.dataset.availability,
      available:button.dataset.next==='true'
    });
  });

  $$('[data-cat-delete]').forEach(button=>{
    button.onclick=async()=>{
      const item=data.catalog.find(x=>x.id===button.dataset.catDelete);
      if(!confirm(`Eliminare definitivamente “${item?.name||'questo prodotto'}”? Per una mancanza temporanea usa Blocca.`)) return;

      try{
        await api('/api/action',{action:'delete_catalog_item',id:button.dataset.catDelete});
        if(catalogEditId===button.dataset.catDelete) catalogEditId=null;
        await load();
      }catch(error){
        alert(error.message);
      }
    };
  });
}

async function act(action,id,extra={}){
  try{
    await api('/api/action',{action,id,...extra});
    await load();
  }catch(error){
    alert(error.message);
  }
}
