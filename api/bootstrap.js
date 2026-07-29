import {supabaseAdmin,validSession,deny} from './_lib.js';

async function fetchAllOrders(s){
  const pageSize=1000;
  const all=[];
  for(let from=0;;from+=pageSize){
    const {data,error}=await s.from('morgante_orders').select('*').order('created_at',{ascending:false}).range(from,from+pageSize-1);
    if(error) throw error;
    all.push(...(data||[]));
    if(!data || data.length<pageSize) break;
  }
  return all;
}

export default async function handler(req,res){
  if(!validSession(req)) return deny(res);
  const s=supabaseAdmin();
  try{
    const [{data:settings,error:e1},{data:catalog,error:e2},orders] = await Promise.all([
      s.from('morgante_settings').select('*').single(),
      s.from('morgante_catalog').select('*').order('kind').order('category').order('sort_order'),
      fetchAllOrders(s)
    ]);
    if(e1||e2) return res.status(500).json({error:e1?.message||e2?.message});
    res.json({settings,catalog,orders});
  }catch(error){
    res.status(500).json({error:error.message});
  }
}
