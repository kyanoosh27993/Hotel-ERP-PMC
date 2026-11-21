/**
 * i18n.ts — دوزبانگی واقعی: پیش‌فرض انگلیسی (قرارداد بخش ۶)، فارسی کامل RTL.
 * ترجمه‌ها ساختاریافته و تخت (key path) برای استفاده در Nest و Next.
 */

export type Lang = 'en' | 'fa';
export const DEFAULT_LANG: Lang = 'en';
export const RTL_LANGS: ReadonlySet<Lang> = new Set(['fa']);

export const DICT = {
  en: {
    'app.name': 'Hotel ERP',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.error': 'Error',
    'common.loading': 'Loading…',
    'auth.login': 'Log in',
    'auth.logout': 'Log out',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.invalidCredentials': 'Invalid username or password',
    'auth.mfaRequired': 'Second factor (TOTP) required for this role',
    'auth.mfaInvalid': 'Invalid TOTP code',
    'auth.forbidden': 'You do not have permission for this action',
    'reservation.created': 'Reservation created',
    'reservation.roomUnavailable': 'Room is not available for the requested range',
    'pos.orderPlaced': 'Order placed',
    'journal.created': 'Journal entry drafted',
    'journal.unbalanced': 'Debits and credits do not balance',
    'journal.notDraft': 'Only draft entries can be modified',
  },
  fa: {
    'app.name': 'نرم‌افزار هتلداری یکپارچه',
    'common.save': 'ذخیره',
    'common.cancel': 'انصراف',
    'common.confirm': 'تأیید',
    'common.error': 'خطا',
    'common.loading': 'در حال بارگذاری…',
    'auth.login': 'ورود',
    'auth.logout': 'خروج',
    'auth.username': 'نام کاربری',
    'auth.password': 'گذرواژه',
    'auth.invalidCredentials': 'نام کاربری یا گذرواژه نادرست است',
    'auth.mfaRequired': 'برای این نقش، عامل دوم (TOTP) الزامی است',
    'auth.mfaInvalid': 'کد TOTP نامعتبر است',
    'auth.forbidden': 'اجازه انجام این عملیات را ندارید',
    'reservation.created': 'رزرو ثبت شد',
    'reservation.roomUnavailable': 'اتاق در بازه درخواستی در دسترس نیست',
    'pos.orderPlaced': 'سفارش ثبت شد',
    'journal.created': 'سند حسابداری پیش‌نویس شد',
    'journal.unbalanced': 'جمع بدهکار و بستانکار برابر نیست',
    'journal.notDraft': 'فقط سند پیش‌نویس قابل ویرایش است',
  },
} as const;

export type MsgKey = keyof (typeof DICT)['en'];

/** ترجمه با زبان و بازگشت به پیش‌فرض انگلیسی */
export function t(lang: Lang, key: MsgKey): string {
  return DICT[lang]?.[key] ?? DICT.en[key] ?? key;
}

/** زبان از هدر Accept-Language با پیش‌فرض انگلیسی */
export function langFromAcceptLanguage(header: string | undefined | null): Lang {
  if (!header) return DEFAULT_LANG;
  const parts = header.toLowerCase().split(',');
  for (const p of parts) {
    const tag = p.split(';')[0].trim();
    if (tag === 'fa' || tag.startsWith('fa-')) return 'fa';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return DEFAULT_LANG;
}

export function isRtl(lang: Lang): boolean {
  return RTL_LANGS.has(lang);
}
