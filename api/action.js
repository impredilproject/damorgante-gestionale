
import {supabaseAdmin,validSession,deny} from './_lib.js';

async function refresh(s){ await s.rpc('morgante_refresh_queue'); }

function sandwichPrice(ingredientIds,catalog){
  const count=ingredientIds.filter(id=>{
    const x=catalog.find(c=>c.id===id);
    return x && x.kind==='ingredient' && x.available && x.counts_for_sandwich_price;
  }).length;
  return count<=2?5:count===3?6:7;
}
function totalFor(body,catalog){
  let total=0;
  for(const sw of body.sandwiches||[]) total+=sandwichPrice(sw.ingredient_ids||[],catalog);
  for(const d of body.drinks||[]){
    const item=catalog.find(c=>c.id===d.item_id && c.kind==='drink' && c.available);
    if(item) total+=Number(item.price)*Math.max(1,Number(d.qty||1));
  }
  return Number(total.toFixed(2));
}
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  if(!validSession(req)) return deny(res);
  const s=supabaseAdmin();
  const {action,...body}=req.body||{};
  try{
    if(action==='toggle_qr'){
      const {error}=await s.from('morgante_settings').update({qr_orders_enabled:!!body.enabled,updated_at:new Date().toISOString()}).eq('id',1);
      if(error) throw error;
    } else if(action==='accept_qr'){
      const {error}=await s.from('morgante_orders').update({status:'queued',accepted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',body.id).eq('status','pending_approval');
      if(error) throw error; await refresh(s);
    } else if(action==='reject_qr'){
      const {error}=await s.from('morgante_orders').update({status:'rejected',updated_at:new Date().toISOString()}).eq('id',body.id).eq('status','pending_approval');
      if(error) throw error;
    } else if(action==='deliver'){
      const {error}=await s.from('morgante_orders').update({status:'delivered',delivered_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',body.id);
      if(error) throw error; await refresh(s);
    } else if(action==='delete_order'){
      const {error}=await s.from('morgante_orders').delete().eq('id',body.id);
      if(error) throw error; await refresh(s);
    } else if(action==='set_availability'){
      const {error}=await s.from('morgante_catalog').update({available:!!body.available}).eq('id',body.id);
      if(error) throw error;
    } else if(action==='create_catalog_item' || action==='update_catalog_item'){
      const name=String(body.name||'').trim();
      const kind=body.kind==='drink'?'drink':'ingredient';
      const category=String(body.category||'Altro').trim()||'Altro';
      const price=kind==='drink'?Math.max(0,Number(body.price||0)):0;
      const counts_for_sandwich_price=kind==='ingredient'?body.counts_for_sandwich_price!==false:false;
      const available=body.available!==false;
      if(!name) throw new Error('Inserisci il nome del prodotto');
      if(!Number.isFinite(price)) throw new Error('Prezzo non valido');
      const payload={name,kind,category,price,counts_for_sandwich_price,available};
      if(action==='create_catalog_item'){
        const {data:last}=await s.from('morgante_catalog').select('sort_order').eq('kind',kind).order('sort_order',{ascending:false}).limit(1);
        payload.sort_order=(last?.[0]?.sort_order||0)+10;
        const {error}=await s.from('morgante_catalog').insert(payload);
        if(error) throw error;
      }else{
        const {error}=await s.from('morgante_catalog').update(payload).eq('id',body.id);
        if(error) throw error;
      }
    } else if(action==='delete_catalog_item'){
      const {error}=await s.from('morgante_catalog').delete().eq('id',body.id);
      if(error) throw error;
    } else if(action==='create_order' || action==='update_order'){
      if(!String(body.customer_name||'').trim()) throw new Error('Il nome cliente è obbligatorio');
      const {data:catalog,error:ce}=await s.from('morgante_catalog').select('*');
      if(ce) throw ce;
      const original_total=totalFor(body,catalog);
      const paid_total=body.payment_status==='paid' ? Number(body.paid_total ?? original_total) : null;
      const discount=body.payment_status==='paid' ? Math.max(0,original_total-paid_total) : 0;
      const payload={
        customer_name:String(body.customer_name).trim(),
        sandwiches:body.sandwiches||[],
        drinks:body.drinks||[],
        original_total,
        paid_total,
        discount,
        payment_status:body.payment_status==='paid'?'paid':'unpaid',
        payment_method:body.payment_method||null,
        notes:body.notes||null,
        updated_at:new Date().toISOString()
      };
      if(action==='create_order'){
        payload.source='manual'; payload.status='queued'; payload.accepted_at=new Date().toISOString();
        const {error}=await s.from('morgante_orders').insert(payload); if(error) throw error;
      }else{
        const {error}=await s.from('morgante_orders').update(payload).eq('id',body.id); if(error) throw error;
      }
      await refresh(s);
    } else throw new Error('Azione sconosciuta');
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message||String(e)});}
}
