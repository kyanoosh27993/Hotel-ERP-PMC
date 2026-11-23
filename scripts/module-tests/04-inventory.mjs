// 04-inventory.mjs — لایه ۱ / ماژول ۴: درخواست خرید، PO، GRN، میانگین موزون، مصرف و اصلاح
import { Suite, req, login, db, sleep } from './_lib.mjs';

const S = new Suite('04-inventory');
const T = { approver: await login('approver', true), storekeeper: await login('storekeeper', false), admin: await login('admin', true) };
const c = await db();

// ریست جداول ماژول خرید/انبار
await c.query(`TRUNCATE "goods_receipt_lines","goods_receipts","purchase_order_lines","purchase_orders","purchase_requisition_lines","purchase_requisitions","stock_count_lines","stock_counts","stock_movements","outbox_events","inbox_events","journal_entries","journal_lines","audit_logs" CASCADE`);
await c.query(`UPDATE "stock_items" SET "qtyOnHand"=0, "avgCostRials"=0`);

const jKey = () => `m04-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// ── درخواست خرید ──
const rq = await req('POST', '/procurement/requisitions', { token: T.storekeeper, body: { items: [{ stockItemCode: 'STK-RICE', qty: 20 }, { stockItemCode: 'STK-BEEF', qty: 10 }] } });
S.step('ثبت درخواست خرید', rq.status === 201, `status=${rq.status} ${JSON.stringify(rq.json?.error ?? {}).slice(0, 100)}`);
const rqNo = rq.json?.reqNo ?? rq.json?.data?.reqNo;
const rqRow = (await c.query(`select status from purchase_requisitions where "reqNo"=$1`, [rqNo])).rows[0];
S.step('خواندن مجدد: درخواست DRAFT', rqRow?.status === 'DRAFT', `db=${rqRow?.status}`);

// ── PO با قیمت واحد صریح ──
const po = await req('POST', '/procurement/orders', { token: T.approver, body: { supplierCode: 'SUP-001', items: [{ stockItemCode: 'STK-RICE', qty: 20, unitCostRials: 150_000 }, { stockItemCode: 'STK-BEEF', qty: 10, unitCostRials: 900_000 }] } });
S.step('ثبت سفارش خرید', po.status === 201, `status=${po.status}`);
const poId = po.json?.id ?? po.json?.data?.id;
const poNo = po.json?.poNo ?? po.json?.data?.poNo;
const poRow = (await c.query(`select status, "subtotalRials"::text as sub from purchase_orders where id=$1`, [poId])).rows[0];
S.step('PO خواندن مجدد: جمع = ۲۰×۱۵۰٬۰۰۰+۱۰×۹۰۰٬۰۰۰', poRow?.status === 'DRAFT' && Number(poRow?.sub) === 12_000_000, `sub=${poRow?.sub}`);

const ap = await req('POST', `/procurement/orders/${poId}/approve`, { token: T.approver, body: {} });
const poAfter = (await c.query(`select status from purchase_orders where id=$1`, [poId])).rows[0];
S.step('تأیید PO → APPROVED', [200, 201].includes(ap.status) && poAfter?.status === 'APPROVED', `status=${ap.status} db=${poAfter?.status}`);

// ── GRN کامل: قیمت از PO می‌آید (payload بدون قیمت) ──
const grn = await req('POST', '/procurement/receipts', { token: T.storekeeper, body: { poCode: poNo, lines: [{ stockItemCode: 'STK-RICE', qtyReceived: 20 }, { stockItemCode: 'STK-BEEF', qtyReceived: 10 }] } });
S.step('رسید خرید از PO', grn.status === 201, `status=${grn.status} ${JSON.stringify(grn.json?.error ?? {}).slice(0, 100)}`);
const rice = (await c.query(`select "qtyOnHand"::text as q, "avgCostRials"::text as avg from stock_items where code='STK-RICE'`)).rows[0];
const beef = (await c.query(`select "qtyOnHand"::text as q, "avgCostRials"::text as avg from stock_items where code='STK-BEEF'`)).rows[0];
// واحد پایه گرام است: ۲۰ کیلو = ۲۰٬۰۰۰ گرم با میانگین ۱۵۰ ریال/گرم
S.step('میانگین موزون برنج (۲۰کیلو=۲۰٬۰۰۰گرم × ۱۵۰)', Number(rice?.q) === 20000 && Number(rice?.avg) === 150, `qty=${rice?.q} avg=${rice?.avg}`);
S.step('میانگین موزون گوشت (۱۰کیلو=۱۰٬۰۰۰گرم × ۹۰۰)', Number(beef?.q) === 10000 && Number(beef?.avg) === 900, `qty=${beef?.q} avg=${beef?.avg}`);

// سند خودکار GRN: هزینه‌ها در ۱۳۰۱
let grnEntry = null;
for (let i = 0; i < 30; i++) { const e = await c.query(`select "entryNo" from journal_entries where "sourceModule"='procurement' and status='POSTED' order by "createdAt" desc limit 1`); if (e.rows[0]) { grnEntry = e.rows[0]; break; } await sleep(400); }
const invLine = (await c.query(`select l."debitRials"::text as d from journal_lines l join journal_entries e on e.id=l."entryId" where e."entryNo"=$1 and l."accountCode"='1301' limit 1`, [grnEntry?.entryNo])).rows[0];
S.step('سند رسید: موجودی ۱۳۰۱ = ۱۲٬۰۰۰٬۰۰۰', Number(invLine?.d) === 12_000_000, `d=${invLine?.d} entry=${grnEntry?.entryNo}`);

// ── GRN اضافه‌تحویل ممنوع ──
const over = await req('POST', '/procurement/receipts', { token: T.storekeeper, body: { poCode: poNo, lines: [{ stockItemCode: 'STK-RICE', qtyReceived: 5 }] } });
S.step('رسید بیش از باقی‌مانده PO → 400', over.status === 400, `status=${over.status}`);

// ── مصرف انبار و اصلاح موجودی ──
// قرارداد واقعی: {stockItemCode, direction: ADJUST_IN/ADJUST_OUT/WASTE, qty>=0, note}
const adj = await req('POST', '/stores/adjustments', { token: T.storekeeper, body: { stockItemCode: 'STK-RICE', direction: 'ADJUST_OUT', qty: 2000, note: 'ضایعات ماژول۴' } });
S.step('ثبت اصلاح موجودی (ADJUST_OUT)', adj.status === 201, `status=${adj.status} ${JSON.stringify(adj.json?.error ?? adj.json?.message ?? {}).slice(0, 100)}`);
if (adj.status === 201) {
  const rice2 = (await c.query(`select "qtyOnHand"::text as q from stock_items where code='STK-RICE'`)).rows[0];
  S.step('اصلاح موجودی: برنج ۲۰٬۰۰۰−۲٬۰۰۰', Number(rice2?.q) === 18000, `qty=${rice2?.q}`);
  const mv = (await c.query(`select direction, qty from stock_movements where "stockItemId"=(select id from stock_items where code='STK-RICE') and direction in ('ADJUST_OUT','WASTE') order by "createdAt" desc limit 1`)).rows[0];
  S.step('حرکت اصلاح در دفتر حرکات ثبت شد', !!mv && Number(mv.qty) === 2000, `${mv?.direction}/${mv?.qty}`);
}

// ── فهرست اقلام: خواندن مجدد لیست ──
const items = (await req('GET', '/stores/items', { token: T.storekeeper })).json ?? [];
const riceItem = items.find((i) => i.code === 'STK-RICE');
S.step('فهرست اقلام انبار هم‌خوان DB', Number(riceItem?.qtyOnHand) === 18000, `api=${riceItem?.qtyOnHand}`);

await c.end();
S.finish();
