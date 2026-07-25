
import {supabaseAdmin,validSession,deny} from './_lib.js';
export default async function handler(req,res){
  if(!validSession(req)) return deny(res);
  const s=supabaseAdmin();
  const [{data:settings,error:e1},{data:catalog,error:e2},{data:orders,error:e3}] = await Promise.all([
    s.from('morgante_settings').select('*').single(),
    s.from('morgante_catalog').select('*').order('kind').order('category').order('sort_order'),
    s.from('morgante_orders').select('*').order('created_at',{ascending:false}).limit(300)
  ]);
  if(e1||e2||e3) return res.status(500).json({error:e1?.message||e2?.message||e3?.message});
  res.json({settings,catalog,orders});
}
