let data={settings:null,catalog:[],orders:[]};
let editId=null;
let catalogEditId=null;
let currentTab='banco';
let bancoSidesOpen=false;
let bancoDrinksOpen=false;
let knownLiveOrderSignatures=null;
let timerInterval=null;
let audioContext=null;
let wakeLock=null;
let wakeLockWanted=true;
let manualOrderSending=false;
let manualSubmissionId=null;

function newSubmissionId(){
  if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,char=>{
    const value=Math.random()*16|0;
    return (char==='x'?value:(value&0x3|0x8)).toString(16);
  });
}

async function requestWakeLock(){
  if(!wakeLockWanted || document.visibilityState!=='visible' || !('wakeLock' in navigator)) return;
  try{
    wakeLock=await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release',()=>{ wakeLock=null; });
  }catch(_){
    wakeLock=null;
  }
}

async function releaseWakeLock(){
  try{ await wakeLock?.release(); }catch(_){}
  wakeLock=null;
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') requestWakeLock();
});
window.addEventListener('focus',requestWakeLock);
window.addEventListener('pageshow',requestWakeLock);


function unlockAudio(){
  if(!audioContext){
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(AudioCtx) audioContext=new AudioCtx();
  }
  if(audioContext?.state==='suspended') audioContext.resume().catch(()=>{});
}
document.addEventListener('pointerdown',unlockAudio,{passive:true});

function playNewOrderSound(){
  try{
    unlockAudio();
    if(!audioContext || audioContext.state!=='running') return;
    const now=audioContext.currentTime;
    [0,0.18,0.36].forEach((delay,index)=>{
      const oscillator=audioContext.createOscillator();
      const gain=audioContext.createGain();
      oscillator.type='sine';
      oscillator.frequency.value=index===1?880:660;
      gain.gain.setValueAtTime(0.0001,now+delay);
      gain.gain.exponentialRampToValueAtTime(0.28,now+delay+0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001,now+delay+0.14);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(now+delay);
      oscillator.stop(now+delay+0.15);
    });
    if(navigator.vibrate) navigator.vibrate([180,80,180]);
  }catch(_){}
}

function detectNewLiveOrders(nextData){
  const signatures=new Map(
    (nextData.orders||[])
      .filter(order=>['pending_approval','queued','preparing'].includes(order.status))
      .map(order=>[order.id,`${order.status}|${order.updated_at||order.created_at}`])
  );
  if(knownLiveOrderSignatures!==null){
    const changed=[...signatures].some(([id,signature])=>knownLiveOrderSignatures.get(id)!==signature);
    if(changed) playNewOrderSound();
  }
  knownLiveOrderSignatures=signatures;
}

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

function emptyDraft(){
  return {
    customer_name:'',
    sandwiches:[{name:'Panino 1',ingredient_ids:[],ingredient_names:[],qty:1}],
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
    body:body?JSON.stringify(body):undefined,
    credentials:'same-origin'
  });
  const json=await response.json().catch(()=>({}));
  if(response.status===401){
    const error=new Error(json.error||'Sessione scaduta');
    error.status=401;
    throw error;
  }
  if(!response.ok) throw new Error(json.error||'Errore');
  return json;
}

$('#loginBtn').onclick=async()=>{
  try{
    await api('/api/login',{pin:$('#pin').value});
    $('#login').hidden=true;
    $('#app').hidden=false;
    await requestWakeLock();
    await load();
  }catch(error){
    $('#loginErr').textContent=error.message;
  }
};

$('#logoutBtn').onclick=async()=>{
  wakeLockWanted=false;
  await releaseWakeLock();
  await api('/api/logout',{});
  location.reload();
};

async function restoreSession(){
  try{
    const nextData=await api('/api/bootstrap');
    detectNewLiveOrders(nextData);
    data=nextData;
    $('#login').hidden=true;
    $('#app').hidden=false;
    await requestWakeLock();
    render();
  }catch(error){
    $('#app').hidden=true;
    $('#login').hidden=false;
    if(error.status!==401){
      $('#loginErr').textContent='Impossibile collegarsi al gestionale. Riprova.';
    }
  }
}

restoreSession();

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
  const sandwichTotal=(draft.sandwiches||[]).reduce((sum,sw)=>sum+sandwichPrice(sw)*Number(sw.qty||1),0);
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
  const nextData=await api('/api/bootstrap');
  detectNewLiveOrders(nextData);
  data=nextData;
  render();
}

setInterval(()=>{
  const tag=document.activeElement?.tagName;
  if(!$('#app').hidden && !['INPUT','TEXTAREA','SELECT'].includes(tag)){
    load().catch(async error=>{
      if(error.status===401){
        await releaseWakeLock();
        $('#app').hidden=true;
        $('#login').hidden=false;
        $('#loginErr').textContent='Sessione scaduta: inserisci nuovamente il PIN.';
      }
    });
  }
},4000);

function orderLines(order,includeDrinks=true){
  let html=(order.sandwiches||[]).map((sw,index)=>`
    <div class="order-line">
      <b>Panino ${index+1} ×${Number(sw.qty||1)}</b>
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

function elapsedMs(order){
  const start=new Date(order.created_at).getTime();
  const end=order.delivered_at?new Date(order.delivered_at).getTime():Date.now();
  return Math.max(0,end-start);
}
function formatElapsed(ms,withSeconds=true){
  const total=Math.floor(ms/1000);
  const minutes=Math.floor(total/60);
  const seconds=total%60;
  return withSeconds?`${minutes} min ${String(seconds).padStart(2,'0')} sec`:`${minutes} min`;
}
function timeClass(ms){
  const min=ms/60000;
  return min<5?'time-green':min<10?'time-yellow':'time-red';
}
function timeBadge(order){
  const ms=elapsedMs(order);
  return `<span class="time-badge ${timeClass(ms)}" data-live-time="${order.id}">⏱ ${formatElapsed(ms)}</span>`;
}
function refreshVisibleTimers(){
  $$('[data-live-time]').forEach(el=>{
    const order=data.orders.find(o=>o.id===el.dataset.liveTime);
    if(!order) return;
    const ms=elapsedMs(order);
    el.textContent=`⏱ ${formatElapsed(ms)}`;
    el.className=`time-badge ${timeClass(ms)}`;
  });
  const oldest=$('[data-oldest-time]');
  if(oldest){
    const live=data.orders.filter(o=>['queued','preparing'].includes(o.status));
    oldest.textContent=live.length?formatElapsed(Math.max(...live.map(elapsedMs)),false):'0 min';
  }
}
if(timerInterval) clearInterval(timerInterval);
timerInterval=setInterval(refreshVisibleTimers,1000);

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
            <div class="muted">Arrivato alle ${new Date(order.created_at).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})}</div>${timeBadge(order)}
          </div>
          <div class="right">
            <b class="total-small">${euro(order.original_total)}</b>
            <span class="badge badge-warn">Da pagare</span>
          </div>
        </div>

        <div class="order-content">${orderLines(order,context==='banco')}</div>

        <div class="accept-box">
          <div class="row">
            <button class="success" data-accept-unpaid="${context}-${order.id}">Accetta da pagare</button>
            <button class="primary" data-accept-paid="${context}-${order.id}">Pagato e accetta</button>
            ${context==='banco'?`<button class="secondary" data-edit-live="${context}-${order.id}">Modifica</button>`:''}
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
      act('accept_qr',id,{mark_paid:true});
    };
  });

  $$(`[data-edit-live^="${context}-"]`).forEach(button=>{
    button.onclick=()=>{
      const id=button.dataset.editLive.slice(context.length+1);
      startEditOrder(id);
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


function ingredientCategoryRank(category){
  const value=String(category||'').trim().toLowerCase();
  if(/(carne|carni|salumi|insaccati)/.test(value)) return 10;
  if(/(contorno|contorni|verdure|ortaggi)/.test(value)) return 20;
  if(/(formaggio|formaggi|latticini)/.test(value)) return 30;
  if(/(salsa|salse|condimenti)/.test(value)) return 40;
  return 100;
}

function groupedIngredients(items){
  const groups=items.reduce((result,item)=>{
    const category=item.category||'Altro';
    (result[category]||=[]).push(item);
    return result;
  },{});

  return Object.entries(groups).sort(([a],[b])=>{
    const rank=ingredientCategoryRank(a)-ingredientCategoryRank(b);
    return rank||a.localeCompare(b,'it');
  });
}

function bancoAccordionSummary(items,type){
  const count=items.reduce((sum,item)=>sum+Number(item.qty||0),0);
  if(!count) return 'Tocca per aprire';
  if(type==='side') return `${count} ${count===1?'porzione selezionata':'porzioni selezionate'}`;
  return items.filter(item=>Number(item.qty)>0).map(item=>`${Number(item.qty)} ${esc(item.name)}`).join(' · ');
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

      <h3>Componi il panino</h3>
      <div id="sandwiches"></div>
      <button id="addSw" class="secondary full">+ Aggiungi panino</button>

      <section class="banco-accordion ${bancoSidesOpen?'open':''}">
        <button type="button" id="toggleBancoSides" class="banco-accordion-toggle">
          <div>
            <h3>Porzioni di patatine${draft.sides.reduce((sum,item)=>sum+Number(item.qty||0),0)?` (${draft.sides.reduce((sum,item)=>sum+Number(item.qty||0),0)})`:''}</h3>
            <span>${bancoAccordionSummary(draft.sides,'side')}</span>
          </div>
          <b>${bancoSidesOpen?'⌃':'⌄'}</b>
        </button>
        <div class="banco-accordion-content">
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
        </div>
      </section>

      <h3>Nome</h3>
      <input id="cust" placeholder="Nome cliente obbligatorio" value="${esc(draft.customer_name)}">

      <section class="banco-accordion ${bancoDrinksOpen?'open':''}">
        <button type="button" id="toggleBancoDrinks" class="banco-accordion-toggle">
          <div>
            <h3>Bevande${draft.drinks.reduce((sum,item)=>sum+Number(item.qty||0),0)?` (${draft.drinks.reduce((sum,item)=>sum+Number(item.qty||0),0)})`:''}</h3>
            <span>${bancoAccordionSummary(draft.drinks,'drink')}</span>
          </div>
          <b>${bancoDrinksOpen?'⌃':'⌄'}</b>
        </button>
        <div class="banco-accordion-content">
          <div class="drink-picker selected-drinks all-drinks">
            ${drinkItems.map(item=>{
              const selected=draft.drinks.find(drink=>drink.item_id===item.id);
              const qty=Number(selected?.qty||0);
              return `
                <div class="drink-pick-row ${qty>0?'selected':''}">
                  <div><b>${esc(item.name)}</b><span>${euro(item.price)}</span></div>
                  <div class="qty">
                    <button data-draft-drink-minus="${item.id}" ${qty===0?'disabled':''}>−</button>
                    <output>${qty}</output>
                    <button data-draft-drink-plus="${item.id}">+</button>
                  </div>
                </div>`;
            }).join('')||'<p class="empty-state">Nessuna bevanda disponibile.</p>'}
          </div>
        </div>
      </section>

      <div class="sep"></div>
      <select id="pay">
        <option value="unpaid">Da pagare</option>
        <option value="paid">Pagato</option>
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
          <b>Panino ${index+1} ×${Number(sw.qty||1)}</b>
          <div class="row">
            <span class="badge">${euro(sandwichPrice(sw)*Number(sw.qty||1))}</span>
            <div class="qty sandwich-qty"><button data-sw-minus="${index}" ${Number(sw.qty||1)<=1?'disabled':''}>−</button><output>×${Number(sw.qty||1)}</output><button data-sw-plus="${index}">+</button></div>
            ${draft.sandwiches.length>1?`<button class="danger small" data-delete-sw="${index}">Rimuovi</button>`:''}
          </div>
        </div>
        <div class="ingredient-category-list">
          ${groupedIngredients(ingredients).map(([category,items])=>`
            <section class="ingredient-category">
              <div class="ingredient-category-title">
                <h4>${esc(category)}</h4>
                ${items.some(item=>ingredientWeight(item)===0.5)?'<span>Le salse valgono ½</span>':''}
              </div>
              <div class="chips">
                ${items.map(item=>`
                  <button class="chip ${(sw.ingredient_ids||[]).includes(item.id)?'on':''}"
                    data-sw-index="${index}" data-ingredient-id="${item.id}">
                    ${esc(item.name)}${ingredientWeight(item)===0.5?' ½':''}
                  </button>`).join('')}
              </div>
            </section>`).join('')}
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

    $$('[data-sw-plus]').forEach(button=>{button.onclick=()=>{syncDraftFields();draft.sandwiches[Number(button.dataset.swPlus)].qty=Math.min(99,Number(draft.sandwiches[Number(button.dataset.swPlus)].qty||1)+1);renderBanco();};});
    $$('[data-sw-minus]').forEach(button=>{button.onclick=()=>{syncDraftFields();const sw=draft.sandwiches[Number(button.dataset.swMinus)];sw.qty=Math.max(1,Number(sw.qty||1)-1);renderBanco();};});

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
    draft.paid_total='';
    draft.payment_method='';
    draft.notes=$('#notes')?.value??draft.notes;
  }

  drawSandwiches();

  $('#toggleBancoSides')?.addEventListener('click',()=>{
    syncDraftFields();
    bancoSidesOpen=!bancoSidesOpen;
    renderBanco();
  });

  $('#toggleBancoDrinks')?.addEventListener('click',()=>{
    syncDraftFields();
    bancoDrinksOpen=!bancoDrinksOpen;
    renderBanco();
  });

  $('#cust').oninput=event=>draft.customer_name=event.target.value;
  $('#pay').value=draft.payment_status;
  $('#pay').onchange=event=>draft.payment_status=event.target.value;
  $('#notes').oninput=event=>draft.notes=event.target.value;

  $('#addSw').onclick=()=>{
    syncDraftFields();
    draft.sandwiches.push({
      name:`Panino ${draft.sandwiches.length+1}`,
      ingredient_ids:[],
      ingredient_names:[],
      qty:1
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
    // Blocca subito i tocchi ripetuti, senza attendere il nuovo caricamento della pagina.
    if(manualOrderSending) return;
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

    const saveButton=$('#save');
    manualOrderSending=true;
    if(saveButton){
      saveButton.disabled=true;
      saveButton.textContent=editing?'Salvataggio…':'Invio…';
    }
    if(!editing) manualSubmissionId ||= newSubmissionId();

    try{
      await api('/api/action',{
        action:editing?'update_order':'create_order',
        id:editing?.id,
        submission_id:editing?undefined:manualSubmissionId,
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
      manualSubmissionId=null;
      await load();
    }catch(error){
      alert(error.message);
    }finally{
      manualOrderSending=false;
      const currentSave=$('#save');
      if(currentSave){
        currentSave.disabled=false;
        currentSave.textContent=editId?'Salva modifiche':'Invia in coda';
      }
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
      <button class="success full" data-mark-paid="${order.id}">PAGATO</button>
    </article>`).join('');
}

function bindUnpaidActions(){
  $$('[data-mark-paid]').forEach(button=>{
    button.onclick=()=>act('mark_paid',button.dataset.markPaid);
  });
}

function renderCoda(){
  const queue=data.orders
    .filter(order=>['preparing','queued'].includes(order.status))
    .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

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
          <div class="queue-summary"><b>${queue.length} ordini</b> · più vecchio <span data-oldest-time>${queue.length?formatElapsed(Math.max(...queue.map(elapsedMs)),false):'0 min'}</span></div>
        </div>
      </div>
      ${queue.length?queue.map((order,index)=>`
        <article class="order ${order.status==='preparing'?'preparing':''}">
          <div class="row between">
            <b class="big">${index+1}. ${esc(order.customer_name)}</b>
            <div class="right">
              <span class="badge">${order.status==='preparing'?'IN PREPARAZIONE':'IN CODA'}</span>
              ${timeBadge(order)}
              <span class="badge ${order.payment_status==='paid'?'badge-ok':'badge-warn'}">${order.payment_status==='paid'?'PAGATO':'DA PAGARE'}</span>
            </div>
          </div>
          <div class="order-content">${orderLines(order,false)}</div>
          <div class="row queue-actions">
            <button class="success" data-deliver="${order.id}">CONSEGNATO</button>
          </div>
        </article>`).join(''):'<p class="empty-state">Nessun panino in coda.</p>'}
    </section>`;

  bindPendingActions('paninaro');
  $$('[data-deliver]').forEach(button=>button.onclick=()=>act('deliver',button.dataset.deliver));
}


function startEditOrder(id){
  const order=data.orders.find(item=>item.id===id);
  if(!order) return;

  editId=order.id;
  draft={
    customer_name:order.customer_name||'',
    sandwiches:(order.sandwiches||[]).length
      ? JSON.parse(JSON.stringify(order.sandwiches)).map(sw=>({...sw,qty:Number(sw.qty||1)}))
      : [{name:'Panino 1',ingredient_ids:[],ingredient_names:[],qty:1}],
    sides:JSON.parse(JSON.stringify(order.sides||[])),
    drinks:JSON.parse(JSON.stringify(order.drinks||[])),
    payment_status:order.payment_status||'unpaid',
    paid_total:'',
    payment_method:'',
    notes:order.notes||''
  };

  const bancoButton=$$('nav button').find(item=>item.dataset.tab==='banco');
  bancoButton?.click();
  setTimeout(()=>document.querySelector('#tab-banco .panel')?.scrollIntoView({behavior:'smooth',block:'start'}),50);
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
        ${order.status==='delivered'?`<div class="delivery-time">Tempo totale: <b>${formatElapsed(elapsedMs(order))}</b></div>`:''}
        <div class="muted">
          Pagamento: ${order.payment_status==='paid'
            ? 'PAGATO'
            : 'DA PAGARE'}
          · Sconto: ${euro(order.discount)}
        </div>
        <div class="row">
          <button class="secondary" data-edit="${order.id}">Modifica</button>
          ${order.status==='delivered'?`<button class="warn" data-reopen="${order.id}">Annulla consegna</button>`:''}
          <button class="danger" data-delete="${order.id}">Elimina</button>
        </div>
      </article>`).join(''):'<p class="empty-state">Nessun ordine nello storico.</p>'}`;

  $$('[data-edit]').forEach(button=>{
    button.onclick=()=>startEditOrder(button.dataset.edit);
  });

  $$('[data-reopen]').forEach(button=>{
    button.onclick=()=>{
      if(confirm('Annullare la consegna e rimettere questo ordine in coda?')){
        act('reopen_order',button.dataset.reopen);
      }
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
