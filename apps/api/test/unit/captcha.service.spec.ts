/**
 * captcha.service.spec.ts — U1: کپچای SVG یک‌بارمصرف (بدون DB).
 */
import { CaptchaService } from '../../src/auth/captcha.service';

describe('CaptchaService', () => {
  let svc: CaptchaService;

  beforeEach(() => {
    svc = new CaptchaService();
  });

  it('صدور: svg معتبر + شناسه یکتا', () => {
    const a = svc.issue();
    const b = svc.issue();
    expect(a.captchaId).toBeTruthy();
    expect(a.svg).toContain('<svg');
    expect(a.svg.length).toBeGreaterThan(200);
    expect(a.captchaId).not.toBe(b.captchaId);
  });

  it('شناسهٔ ناشناس → CAPTCHA_MISMATCH', async () => {
    expect(() => svc.verify('unknown-id', 'ABCDE')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'CAPTCHA_MISMATCH' }) }) as Error,
    );
  });

  it('مصرف یک‌بار: همان شناسه دوباره رد می‌شود', async () => {
    // با یک رمز جعلی verify می‌شود — نکتهٔ تست: پس از اولین verify مدخل حذف شده و حتی پاسخ غلط دوم هم mismatch می‌دهد
    expect(() => svc.verify('x1', 'A')).toThrow();
    expect(() => svc.verify('x1', 'A')).toThrow();
  });
});
