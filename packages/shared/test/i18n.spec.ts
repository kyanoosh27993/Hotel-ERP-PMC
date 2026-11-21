import { t, langFromAcceptLanguage, isRtl, DEFAULT_LANG } from '../src/i18n';

describe('i18n — پیش‌فرض انگلیسی، فارسی کامل', () => {
  it('زبان پیش‌فرض انگلیسی است (قرارداد بخش ۶)', () => {
    expect(DEFAULT_LANG).toBe('en');
  });

  it('ترجمه و بازگشت به انگلیسی', () => {
    expect(t('en', 'auth.login')).toBe('Log in');
    expect(t('fa', 'auth.login')).toBe('ورود');
    expect(t('fa', 'reservation.roomUnavailable')).toContain('در دسترس نیست');
  });

  it('Accept-Language پارس می‌شود', () => {
    expect(langFromAcceptLanguage('fa-IR,fa;q=0.9,en;q=0.8')).toBe('fa');
    expect(langFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(langFromAcceptLanguage(undefined)).toBe('en');
  });

  it('RTL فقط فارسی', () => {
    expect(isRtl('fa')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});
