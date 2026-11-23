import { req, login } from '/home/z/my-project/hotel-erp/scripts/module-tests/_lib.mjs';
const acc = await login('accountant', true);
const app = await login('approver', true);
const mk = await req('POST', '/journal-entries', { token: acc, body: {
  description: 'UITEST فروش با مالیات', lines: [
    { accountCode: '1201', debit: 5500000, credit: 0 },
    { accountCode: '4101', debit: 0, credit: 5000000 },
    { accountCode: '2201', debit: 0, credit: 500000 },
  ]}});
if (![200,201].includes(mk.status)) { console.log('create failed', mk.status, JSON.stringify(mk.json)); process.exit(1); }
const id = mk.json.data.id;
const ap = await req('POST', `/journal-entries/${id}/approve`, { token: app, body: {} });
console.log('approved:', ap.status, mk.json.data.entryNo);
