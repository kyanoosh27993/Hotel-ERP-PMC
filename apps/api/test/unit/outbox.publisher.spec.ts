/**
 * outbox.publisher.spec.ts — تست واحد F1-T2: بدون گم‌شدن رویداد در شکست مصنوعی.
 * نگارخانه InMemory + شبیه‌سازی «کرش» بین ثبت و انتشار → توزیع دقیقاً یک‌بار.
 */
import { OutboxService } from '../../src/outbox/outbox.service';
import { OutboxPublisher } from '../../src/outbox/outbox.publisher';
import type { ClaimedEvent, OutboxStoreLike } from '../../src/outbox/outbox.types';
import { EVENT_NAMES } from '@hotel-erp/contracts';

class InMemoryOutboxStore implements OutboxStoreLike {
  private seq = 0;
  readonly rows = new Map<string, { ev: Omit<ClaimedEvent, 'id'>; id: string; published: boolean; attempts: number; nextAttemptAt: number }>();

  async enqueue(ev: Omit<ClaimedEvent, 'id'>): Promise<string> {
    this.seq += 1;
    const id = `evt-${this.seq}`;
    this.rows.set(id, { ev, id, published: false, attempts: 0, nextAttemptAt: 0 });
    return id;
  }

  async claimBatch(limit: number): Promise<ClaimedEvent[]> {
    const now = Date.now();
    const out: ClaimedEvent[] = [];
    for (const row of this.rows.values()) {
      if (!row.published && row.nextAttemptAt <= now && out.length < limit) {
        row.attempts += 1;
        out.push({ ...row.ev, id: row.id });
      }
    }
    return out;
  }

  async markPublished(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.published = true;
  }

  async markFailed(id: string, _error: string, nextAttemptAt: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.nextAttemptAt = nextAttemptAt.getTime();
  }
}

describe('OutboxPublisher — حداقل یک‌بار تحویل با مصرف تکرارپذیر', () => {
  function setup() {
    const store = new InMemoryOutboxStore();
    const outbox = new OutboxService();
    const publisher = new OutboxPublisher(store, outbox);
    return { store, outbox, publisher };
  }

  it('رویداد ثبت‌شده در تراکنش، پس از «کرش» پیش از انتشار، در شروع مجدد تحویل می‌شود', async () => {
    const { store, outbox, publisher } = setup();

    // شبیه‌سازی تراکنش دامنه: ثبت رویداد در store (همان atomicy) و سپس کرش
    const handlerCalls: string[] = [];
    outbox.on(EVENT_NAMES.RESERVATION_CONFIRMED, async (e) => {
      handlerCalls.push(e.payload['reservationId'] as string);
    });
    await store.enqueue({
      eventName: EVENT_NAMES.RESERVATION_CONFIRMED,
      aggregate: 'reservation',
      producer: 'booking',
      version: 1,
      idempotencyKey: 'rsv-1',
      payload: { reservationId: 'rsv-1' },
      createdAt: new Date(),
    });
    // ── کرش: publishOnce هنوز اجرا نشده؛ برنامه down می‌شود ──
    expect(handlerCalls).toHaveLength(0);

    // ── راه‌اندازی مجدد: همان store (دیتابیس)، ناشر جدید ──
    const count = await publisher.publishOnce();
    expect(count).toBe(1);
    expect(handlerCalls).toEqual(['rsv-1']);
  });

  it('اجرای دوباره ناشر، تحویل تکراری ایجاد نمی‌کند (انتشار نشانه‌گذاری‌شده)', async () => {
    const { store, outbox, publisher } = setup();
    let calls = 0;
    outbox.on(EVENT_NAMES.RESERVATION_CONFIRMED, async () => {
      calls += 1;
    });
    await store.enqueue({
      eventName: EVENT_NAMES.RESERVATION_CONFIRMED,
      aggregate: 'reservation',
      producer: 'booking',
      version: 1,
      idempotencyKey: 'rsv-2',
      payload: { reservationId: 'rsv-2' },
      createdAt: new Date(),
    });
    await publisher.publishOnce();
    await publisher.publishOnce();
    await publisher.publishOnce();
    expect(calls).toBe(1);
  });

  it('شکست مصرف‌کننده → backoff → تلاش مجدد بعدی موفق (هیچ رویدادی گم نمی‌شود)', async () => {
    const { store, outbox, publisher } = setup();
    let failFirst = true;
    outbox.on(EVENT_NAMES.POS_ORDER_SERVED, async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error('simulated consumer failure');
      }
    });
    await store.enqueue({
      eventName: EVENT_NAMES.POS_ORDER_SERVED,
      aggregate: 'pos_order',
      producer: 'pos',
      version: 1,
      idempotencyKey: 'ord-1',
      payload: { orderId: 'ord-1' },
      createdAt: new Date(),
    });

    await publisher.publishOnce(); // شکست می‌خورد → markFailed با nextAttemptAt آینده
    const row = [...store.rows.values()][0];
    expect(row.published).toBe(false);
    expect(row.nextAttemptAt).toBeGreaterThan(Date.now());

    // بازپخش پس از گذر زمان backoff
    row.nextAttemptAt = Date.now() - 1;
    await publisher.publishOnce();
    expect(row.published).toBe(true);
  });

  it('رویداد بدون مصرف‌کننده: بدون خطا علامت «تحویل‌شده» می‌خورد (هشدار ثبت می‌شود)', async () => {
    const { store, publisher } = setup();
    // هیچ handler ثبت نشده
    await store.enqueue({
      eventName: EVENT_NAMES.JOURNAL_ENTRY_POSTED,
      aggregate: 'journal',
      producer: 'accounting',
      version: 1,
      idempotencyKey: 'j-1',
      payload: {},
      createdAt: new Date(),
    });
    const count = await publisher.publishOnce();
    expect(count).toBe(1);
    expect([...store.rows.values()][0].published).toBe(true);
  });
});

describe('OutboxService.enqueue — کلید تکرارناپذیری', () => {
  it('newKey پیشونددار و یکتاست', () => {
    const a = OutboxService.newKey('pos');
    const b = OutboxService.newKey('pos');
    expect(a.startsWith('pos:')).toBe(true);
    expect(a).not.toBe(b);
  });
});
