/**
 * doc-seq.ts — شماره‌گذاری اسناد با توالی PostgreSQL.
 * الگوی قبلی (count()+1) در هم‌روندی تداخل شماره می‌ساخت: دو تراکنش همان شماره
 * را می‌گرفتند و unique violation → ۵۰۰. nextval اتمیک است و این ردهٔ خطا را حذف می‌کند.
 */
import { Prisma } from '@prisma/client';

const SEQ_MAP: Record<string, string> = {
  reservation: 'seq_reservation',
  stay: 'seq_stay',
  rest_order: 'seq_rest_order',
  kitchen_ticket: 'seq_kitchen_ticket',
  pos_order: 'seq_pos_order',
  anc_order: 'seq_anc_order',
  shift: 'seq_shift',
  cash_txn: 'seq_cash_txn',
  req: 'seq_req',
  po: 'seq_po',
  grn: 'seq_grn',
  stock_count: 'seq_stock_count',
  maintenance: 'seq_maintenance',
  laundry: 'seq_laundry',
  lostfound: 'seq_lostfound',
  asset: 'seq_asset',
  journal: 'seq_journal',
};

/** شمارهٔ بعدی سند درون تراکنش — اتمیک حتی با درخواست هم‌زمان */
export async function nextDocSeq(tx: Prisma.TransactionClient, key: keyof typeof SEQ_MAP | string): Promise<number> {
  const name = SEQ_MAP[key];
  if (!name) throw new Error(`Unknown doc sequence key: ${key}`);
  const rows = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval(${name})::text as nextval`;
  return Number(rows[0].nextval);
}
