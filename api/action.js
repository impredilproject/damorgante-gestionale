import {supabaseAdmin,validSession,deny} from './_lib.js';

async function refresh(s){
  const {error}=await s.rpc('morgante_refresh_queue');
  if(error) throw error;
}

function ingredientWeight(item){
  if(!item || item.kind!=='ingredient' || !item.available) return 0;
  const weight=Number(item.sandwich_price_weight);
  if(Number.isFinite(weight) && weight>0) return weight;
  return item.counts_for_sandwich_price?1:0.5;
}

function sandwichPrice(ingredientIds,catalog){
  const unique=[...new Set(ingredientIds||[])];
  const count=unique.reduce((sum,id)=>sum+ingredientWeight(catalog.find(item=>item.id===id)),0);
  if(count<=0) return 0;
  if(count<=2) return 5;
  if(count<=3) return 6;
  return 7;
}

function normalizeOrderItems(body){
  const sandwiches=(body.sandwiches||[])
    .filter(sw=>Array.isArray(sw.ingredient_ids) && sw.ingredient_ids.length>0)
    .map((sw,index)=>({
      name:`Panino ${index+1}`,
      ingredient_ids:[...new Set(sw.ingredient_ids||[])],
      ingredient_names:[...new Set(sw.ingredient_names||[])]
    }));

  const sides=(body.sides||[])
    .map(side=>({...side,qty:Math.max(0,Number(side.qty||0))}))
    .filter(side=>side.item_id && side.qty>0);

  const drinks=(body.drinks||[])
    .map(drink=>({...drink,qty:Math.max(0,Number(drink.qty||0))}))
    .filter(drink=>drink.item_id && drink.qty>0);

  return {sandwiches,sides,drinks};
}

function totalFor(items,catalog){
  let total=0;

  for(const sw of items.sandwiches){
    total+=sandwichPrice(sw.ingredient_ids,catalog);
  }

  for(const side of items.sides){
    const item=catalog.find(c=>c.id===side.item_id && c.kind==='side' && c.available);
    if(item) total+=Number(item.price)*side.qty;
  }

  for(const drink of items.drinks){
    const item=catalog.find(c=>c.id===drink.item_id && c.kind==='drink' && c.available);
    if(item) total+=Number(item.price)*drink.qty;
  }

  return Number(total.toFixed(2));
}

async function getPendingOrder(s,id){
  const {data,error}=await s
    .from('morgante_orders')
    .select('id,original_total,payment_status,payment_required_before_acceptance')
    .eq('id',id)
    .eq('status','pending_approval')
    .single();

  if(error) throw new Error('Richiesta non più disponibile o già gestita');
  return data;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  if(!validSession(req)) return deny(res);

  const s=supabaseAdmin();
  const {action,...body}=req.body||{};

  try{
    if(action==='toggle_qr'){
      const {error}=await s
        .from('morgante_settings')
        .update({
          qr_orders_enabled:!!body.enabled,
          updated_at:new Date().toISOString()
        })
        .eq('id',1);
      if(error) throw error;

    }else if(action==='toggle_payment_rule'){
      const {error}=await s
        .from('morgante_settings')
        .update({
          qr_payment_before_acceptance:!!body.enabled,
          updated_at:new Date().toISOString()
        })
        .eq('id',1);
      if(error) throw error;

    }else if(action==='accept_qr'){
      const order=await getPendingOrder(s,body.id);
      const markPaid=!!body.mark_paid;

      if(order.payment_required_before_acceptance && !markPaid){
        throw new Error('Questa richiesta deve essere pagata prima dell’accettazione');
      }

      const update={
        status:'queued',
        accepted_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      };

      if(markPaid){
        const method=String(body.payment_method||'').trim();
        if(!method) throw new Error('Seleziona il metodo di pagamento');

        update.payment_status='paid';
        update.paid_total=Number(order.original_total);
        update.discount=0;
        update.payment_method=method;
      }

      const {error}=await s
        .from('morgante_orders')
        .update(update)
        .eq('id',body.id)
        .eq('status','pending_approval');

      if(error) throw error;
      await refresh(s);

    }else if(action==='reject_qr'){
      const {error}=await s
        .from('morgante_orders')
        .update({
          status:'rejected',
          updated_at:new Date().toISOString()
        })
        .eq('id',body.id)
        .eq('status','pending_approval');

      if(error) throw error;

    }else if(action==='mark_paid'){
      const method=String(body.payment_method||'').trim();
      if(!method) throw new Error('Seleziona il metodo di pagamento');

      const {data:order,error:readError}=await s
        .from('morgante_orders')
        .select('original_total')
        .eq('id',body.id)
        .single();

      if(readError) throw readError;

      const paidTotal=body.paid_total==='' || body.paid_total===undefined
        ? Number(order.original_total)
        : Number(body.paid_total);

      if(!Number.isFinite(paidTotal) || paidTotal<0){
        throw new Error('Importo non valido');
      }

      const {error}=await s
        .from('morgante_orders')
        .update({
          payment_status:'paid',
          paid_total:paidTotal,
          discount:Math.max(0,Number(order.original_total)-paidTotal),
          payment_method:method,
          updated_at:new Date().toISOString()
        })
        .eq('id',body.id);

      if(error) throw error;

    }else if(action==='deliver'){
      const {error}=await s
        .from('morgante_orders')
        .update({
          status:'delivered',
          delivered_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        })
        .eq('id',body.id);

      if(error) throw error;
      await refresh(s);

    }else if(action==='delete_order'){
      const {error}=await s.from('morgante_orders').delete().eq('id',body.id);
      if(error) throw error;
      await refresh(s);

    }else if(action==='set_availability'){
      const {error}=await s
        .from('morgante_catalog')
        .update({available:!!body.available})
        .eq('id',body.id);

      if(error) throw error;

    }else if(action==='create_catalog_item' || action==='update_catalog_item'){
      const name=String(body.name||'').trim();
      const kind=['drink','side'].includes(body.kind)?body.kind:'ingredient';
      const category=String(body.category||'Altro').trim()||'Altro';
      const price=kind==='ingredient'?0:Math.max(0,Number(body.price||0));
      const weight=kind==='ingredient'?Number(body.sandwich_price_weight||1):0;
      const available=body.available!==false;

      if(!name) throw new Error('Inserisci il nome del prodotto');
      if(!Number.isFinite(price)) throw new Error('Prezzo non valido');
      if(kind==='ingredient' && ![0.5,1].includes(weight)){
        throw new Error('Scegli 1 ingrediente oppure 1/2 ingrediente');
      }

      const payload={
        name,
        kind,
        category,
        price,
        available,
        sandwich_price_weight:weight,
        counts_for_sandwich_price:kind==='ingredient'
      };

      if(action==='create_catalog_item'){
        const {data:last}=await s
          .from('morgante_catalog')
          .select('sort_order')
          .eq('kind',kind)
          .order('sort_order',{ascending:false})
          .limit(1);

        payload.sort_order=(last?.[0]?.sort_order||0)+10;

        const {error}=await s.from('morgante_catalog').insert(payload);
        if(error) throw error;
      }else{
        const {error}=await s
          .from('morgante_catalog')
          .update(payload)
          .eq('id',body.id);

        if(error) throw error;
      }

    }else if(action==='delete_catalog_item'){
      const {error}=await s.from('morgante_catalog').delete().eq('id',body.id);
      if(error) throw error;

    }else if(action==='create_order' || action==='update_order'){
      if(!String(body.customer_name||'').trim()){
        throw new Error('Il nome cliente è obbligatorio');
      }

      const items=normalizeOrderItems(body);

      if(items.sandwiches.length===0 && items.sides.length===0 && items.drinks.length===0){
        throw new Error('Aggiungi almeno un ingrediente o una bevanda');
      }

      const {data:catalog,error:catalogError}=await s
        .from('morgante_catalog')
        .select('*');

      if(catalogError) throw catalogError;

      const original_total=totalFor(items,catalog);
      const isPaid=body.payment_status==='paid';
      const paid_total=isPaid
        ? Number(body.paid_total==='' || body.paid_total===undefined
          ? original_total
          : body.paid_total)
        : null;

      if(isPaid && (!Number.isFinite(paid_total) || paid_total<0)){
        throw new Error('Importo incassato non valido');
      }

      if(isPaid && !String(body.payment_method||'').trim()){
        throw new Error('Seleziona il metodo di pagamento');
      }

      const payload={
        customer_name:String(body.customer_name).trim(),
        sandwiches:items.sandwiches,
        sides:items.sides,
        drinks:items.drinks,
        original_total,
        paid_total,
        discount:isPaid?Math.max(0,original_total-paid_total):0,
        payment_status:isPaid?'paid':'unpaid',
        payment_method:isPaid?body.payment_method:null,
        notes:body.notes||null,
        updated_at:new Date().toISOString()
      };

      if(action==='create_order'){
        payload.source='manual';
        payload.status='queued';
        payload.accepted_at=new Date().toISOString();
        payload.payment_required_before_acceptance=false;

        const {error}=await s.from('morgante_orders').insert(payload);
        if(error) throw error;
      }else{
        const {error}=await s
          .from('morgante_orders')
          .update(payload)
          .eq('id',body.id);

        if(error) throw error;
      }

      await refresh(s);

    }else{
      throw new Error('Azione sconosciuta');
    }

    res.json({ok:true});
  }catch(error){
    res.status(400).json({error:error.message||String(error)});
  }
}
