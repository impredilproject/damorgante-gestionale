import {supabaseAdmin,validSession,deny} from './_lib.js';

export default async function handler(req,res){
  if(!validSession(req)) return deny(res);

  try{
    const s=supabaseAdmin();
    const [settingsResult,catalogResult,ordersResult] = await Promise.all([
      s.from('morgante_settings').select('*').limit(1).maybeSingle(),
      s.from('morgante_catalog').select('*').order('kind').order('category').order('sort_order'),
      s.from('morgante_orders').select('*').order('created_at',{ascending:false}).limit(1000)
    ]);

    const error=settingsResult.error || catalogResult.error || ordersResult.error;
    if(error) return res.status(500).json({error:error.message});
    if(!settingsResult.data) return res.status(500).json({error:'Impostazioni del gestionale non trovate'});

    return res.status(200).json({
      settings:settingsResult.data,
      catalog:catalogResult.data || [],
      orders:ordersResult.data || []
    });
  }catch(error){
    return res.status(500).json({error:error?.message || 'Errore di collegamento al database'});
  }
}
