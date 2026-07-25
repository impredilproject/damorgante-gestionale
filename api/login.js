
import crypto from 'crypto';
import { signSession } from './_lib.js';
export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  const pin=String(req.body?.pin||'');
  const expected=String(process.env.MANAGER_PIN||'');
  const ok=pin.length===expected.length && crypto.timingSafeEqual(Buffer.from(pin),Buffer.from(expected));
  if(!ok) return res.status(401).json({error:'PIN errato'});
  const token=signSession();
  res.setHeader('Set-Cookie',`morgante_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
  res.json({ok:true});
}
