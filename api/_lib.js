
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || 'https://xvlwxlqcszcdmhfogncs.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Manca SUPABASE_SERVICE_ROLE_KEY nelle variabili Vercel');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
export function signSession() {
  const exp = Date.now() + 12*60*60*1000;
  const body = String(exp);
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}
export function validSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/morgante_session=([^;]+)/);
  if (!m) return false;
  const [body,sig] = m[1].split('.');
  if (!body || !sig || Number(body) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}
export function deny(res){ return res.status(401).json({error:'Non autorizzato'}); }
