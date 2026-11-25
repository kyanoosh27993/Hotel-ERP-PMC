/**
 * captcha.service.ts — کپچای تصویری SVG سمت سرور (معادل الگوی کپچای تصویری)
 * یک‌بارمصرف + TTL پنج دقیقه + ذخیرهٔ هش پاسخ (بدون نگه‌داشتن متن خام).
 * درخواستی که از سرویس‌های تست استفاده می‌کند با AUTH_CAPTCHA_REQUIRED=false غیرفعال می‌شود.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';

interface CaptchaEntry {
  answerHash: string;
  expiresAt: number;
}

/** الفبای بدون نویسه‌های گنگ (۰/O، ۱/l، I) */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const TTL_MS = 5 * 60_000;
const MAX_STORED = 10_000;

@Injectable()
export class CaptchaService {
  private store = new Map<string, CaptchaEntry>();

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private randomCode(): string {
    let out = '';
    const bytes = randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
    return out;
  }

  /** صدور کپچای جدید: id + svg برای نمایش */
  issue(): { captchaId: string; svg: string } {
    if (this.store.size > MAX_STORED) this.cleanup();
    const code = this.randomCode();
    const captchaId = randomUUID();
    this.store.set(captchaId, { answerHash: this.sha256(code.toUpperCase()), expiresAt: Date.now() + TTL_MS });
    return { captchaId, svg: this.render(code) };
  }

  /** بررسی یک‌بارمصرف — پس از خواندن، مدخل حذف می‌شود */
  verify(captchaId: string, text: string): void {
    const entry = captchaId ? this.store.get(captchaId) : undefined;
    this.store.delete(captchaId);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new BadRequestException({ code: 'CAPTCHA_MISMATCH', message: 'حروف امنیتی مطابقت ندارند.' });
    }
    const given = (text ?? '').trim().toUpperCase();
    const a = Buffer.from(this.sha256(given), 'hex');
    const b = Buffer.from(entry.answerHash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException({ code: 'CAPTCHA_MISMATCH', message: 'حروف امنیتی مطابقت ندارند.' });
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [k, v] of this.store) if (v.expiresAt < now) this.store.delete(k);
  }

  /** رندر SVG: پنج نویسهٔ چرخیده + خطوط نویز + رنگ مرجع */
  private render(code: string): string {
    const W = 160;
    const H = 48;
    const chars: string[] = [];
    const step = (W - 36) / CODE_LENGTH;
    for (let i = 0; i < CODE_LENGTH; i++) {
      const angle = ((randomBytes(1)[0] % 30) - 15).toFixed(0);
      const dy = ((randomBytes(1)[0] % 8) - 4).toFixed(0);
      const size = 24 + (randomBytes(1)[0] % 8);
      const colors = ['#1d4ed8', '#0f766e', '#7c2d12', '#374151', '#4338ca'];
      const fill = colors[randomBytes(1)[0] % colors.length];
      chars.push(
        `<text x="${(22 + i * step).toFixed(1)}" y="${(32 + Number(dy)).toFixed(1)}" font-size="${size}" ` +
          `font-family="'Courier New',monospace" font-weight="bold" fill="${fill}" ` +
          `transform="rotate(${angle} ${(22 + i * step).toFixed(1)} ${(32 + Number(dy)).toFixed(1)})">${code[i]}</text>`,
      );
    }
    let noise = '';
    for (let i = 0; i < 4; i++) {
      const x1 = randomBytes(1)[0] % W;
      const y1 = randomBytes(1)[0] % H;
      const x2 = randomBytes(1)[0] % W;
      const y2 = randomBytes(1)[0] % H;
      noise += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#93a7c8" stroke-width="1" opacity="0.6"/>`;
    }
    for (let i = 0; i < 30; i++) {
      noise += `<circle cx="${randomBytes(1)[0] % W}" cy="${randomBytes(1)[0] % H}" r="1" fill="#5b79a6" opacity="0.35"/>`;
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="captcha">` +
      `<rect width="${W}" height="${H}" fill="#eef3fb"/>` +
      `<path d="M0,${H - 6} Q${W / 3},${H - 18} ${W},${H - 10}" stroke="#b9c9e4" fill="none" stroke-width="1.5"/>` +
      noise + chars.join('') + `</svg>`
    );
  }
}
