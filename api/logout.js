
export default async function handler(req,res){
  res.setHeader('Set-Cookie','morgante_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ok:true});
}
