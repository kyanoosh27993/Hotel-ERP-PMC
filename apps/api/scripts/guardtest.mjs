const BASE='http://localhost:3000/api/v1';
const {createHmac}=await import('node:crypto');
const totp=()=>{const S='JBSWY3DPEHPK3PXPE2ETEST',A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let b='';for(const c of S){const i=A.indexOf(c);if(i>=0)b+=i.toString(2).padStart(5,'0')}const k=Buffer.from(Array.from({length:b.length/8},(_,i)=>parseInt(b.slice(i*8,i*8+8),2)));const ctr=Math.floor(Date.now()/30000);const buf=Buffer.alloc(8);buf.writeUInt32BE(Math.floor(ctr/2**32),0);buf.writeUInt32BE(ctr%2**32,4);const h=createHmac('sha1',k).update(buf).digest();const o=h[h.length-1]&0xf;return String(((h[o]&0x7f)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0')};
const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'ChangeMe_Str0ng!'})});
const t=(await r.json()).accessToken;
const rt=(await (await fetch(BASE+'/room-types',{headers:{Authorization:'Bearer '+t}})).json()).data.find(x=>x.code==='JUN');
const d=(n)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
for (let i=1;i<=3;i++){
  const res=await fetch(BASE+'/pms/reservations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({roomTypeId:rt.id,guestName:'تست نگهبان '+i,checkInDate:d(20),checkOutDate:d(21),idempotencyKey:`gt-${Date.now()}-${i}`})});
  console.log('attempt',i,'→',res.status,(await res.json()).error?.message ?? 'OK');
}
