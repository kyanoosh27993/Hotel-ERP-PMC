const BASE='http://localhost:3000/api/v1';
const r=await fetch(BASE+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'chef',password:'ChangeMe_Str0ng!'})});
const t=(await r.json()).accessToken;
const k=await (await fetch(BASE+'/restaurant/kitchen/tickets',{headers:{Authorization:'Bearer '+t}})).json();
console.log(JSON.stringify(k).slice(0,500));
