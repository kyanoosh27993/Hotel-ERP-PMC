const BASE='http://localhost:3000/api/v1';
const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'frontdesk',password:'ChangeMe_Str0ng!'})});
const t=(await r.json()).accessToken;
const rt=(await (await fetch(BASE+'/room-types',{headers:{Authorization:'Bearer '+t}})).json()).data.find(x=>x.code==='STD');
const d=(n)=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
const res=await fetch(BASE+'/pms/reservations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({roomTypeId:rt.id,guestName:'شکننده مرز',checkInDate:d(10),checkOutDate:d(11),idempotencyKey:`gt2-${Date.now()}`})});
console.log('attempt 16 →', res.status, (await res.json()).error?.message ?? 'OK');
