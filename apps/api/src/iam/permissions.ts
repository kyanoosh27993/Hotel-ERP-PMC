/**
 * permissions.ts — فهرست مجوزها و ماتریس نقش‌ها (RBAC) — سمت سرور اعمال می‌شود.
 * نمونه الزامی قرارداد: حسابدار می‌تواند مشاهده/پیش‌نویس/ویرایش/ارسال به تأیید؛
 * نمی‌تواند خودتأییری/حذف قطعی/تغییر حساب حساس/مشاهده داشبورد مدیرعامل.
 */
export const PERMISSIONS = {
  JOURNAL_VIEW: 'journal.view',
  JOURNAL_CREATE_DRAFT: 'journal.create_draft',
  JOURNAL_EDIT_DRAFT: 'journal.edit_draft',
  JOURNAL_SUBMIT: 'journal.submit_for_approval',
  JOURNAL_APPROVE: 'journal.approve',
  JOURNAL_REVERSE: 'journal.reverse',
  SENSITIVE_ACCOUNTS_EDIT: 'sensitive_accounts.edit',
  PERIOD_LOCK: 'period.lock',
  RESERVATION_CREATE: 'reservation.create',
  ROOM_VIEW: 'room.view',
  ROOM_MANAGE: 'room.manage',
  POS_ORDER_CREATE: 'pos.order.create',
  INTEGRATIONS_VIEW: 'integrations.view',
  DASHBOARD_CEO_VIEW: 'dashboard.ceo.view',
  AUDIT_VIEW: 'audit.view',
  // فاز ۲ — حقوق و دستمزد
  PERSONNEL_VIEW: 'personnel.view',
  PERSONNEL_EDIT: 'personnel.edit',
  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_CALCULATE: 'payroll.calculate',
  PAYROLL_APPROVE: 'payroll.approve',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: Array<{ code: PermissionCode; en: string; fa: string }> = [
  { code: PERMISSIONS.JOURNAL_VIEW, en: 'View journal entries', fa: 'مشاهده اسناد حسابداری' },
  { code: PERMISSIONS.JOURNAL_CREATE_DRAFT, en: 'Create draft journal entries', fa: 'ثبت پیش‌نویس سند' },
  { code: PERMISSIONS.JOURNAL_EDIT_DRAFT, en: 'Edit draft journal entries', fa: 'ویرایش سند پیش‌نویس' },
  { code: PERMISSIONS.JOURNAL_SUBMIT, en: 'Submit entries for approval', fa: 'ارسال سند به تأیید' },
  { code: PERMISSIONS.JOURNAL_APPROVE, en: 'Approve journal entries', fa: 'تأیید نهایی سند' },
  { code: PERMISSIONS.JOURNAL_REVERSE, en: 'Reverse posted entries', fa: 'برگشت سند قطعی' },
  { code: PERMISSIONS.SENSITIVE_ACCOUNTS_EDIT, en: 'Edit sensitive accounts', fa: 'ویرایش حساب‌های حساس' },
  { code: PERMISSIONS.PERIOD_LOCK, en: 'Lock/unlock fiscal periods', fa: 'قفل/بازگشایی دوره مالی' },
  { code: PERMISSIONS.RESERVATION_CREATE, en: 'Create reservations', fa: 'ثبت رزرو' },
  { code: PERMISSIONS.ROOM_VIEW, en: 'View rooms', fa: 'مشاهده اتاق‌ها' },
  { code: PERMISSIONS.ROOM_MANAGE, en: 'Change room status / check-in / check-out', fa: 'تغییر وضعیت اتاق، چک‌این و چک‌اوت' },
  { code: PERMISSIONS.POS_ORDER_CREATE, en: 'Create POS orders', fa: 'ثبت سفارش POS' },
  { code: PERMISSIONS.INTEGRATIONS_VIEW, en: 'View integrations', fa: 'مشاهده یکپارچگی‌ها' },
  { code: PERMISSIONS.DASHBOARD_CEO_VIEW, en: 'View CEO dashboard', fa: 'مشاهده داشبورد مدیرعامل' },
  { code: PERMISSIONS.AUDIT_VIEW, en: 'View audit logs', fa: 'مشاهده لاگ حسابرسی' },
  { code: PERMISSIONS.PERSONNEL_VIEW, en: 'View personnel records', fa: 'مشاهده پرونده پرسنلی' },
  { code: PERMISSIONS.PERSONNEL_EDIT, en: 'Create/edit personnel and decisions', fa: 'ثبت/ویرایش پرسنل و احکام' },
  { code: PERMISSIONS.PAYROLL_VIEW, en: 'View payroll runs and lists', fa: 'مشاهده دوره‌های حقوق و لیست‌ها' },
  { code: PERMISSIONS.PAYROLL_CALCULATE, en: 'Calculate payroll runs', fa: 'محاسبه دوره حقوق' },
  { code: PERMISSIONS.PAYROLL_APPROVE, en: 'Approve payroll runs and decisions', fa: 'تأیید احکام و دوره حقوق' },
];

/** ماتریس نقش‌ها — مرجع واحد ماتریس دسترسی */
export const ROLE_MATRIX: Record<
  string,
  { en: string; fa: string; sensitiveMfa: boolean; permissions: PermissionCode[] }
> = {
  admin: {
    en: 'Administrator',
    fa: 'مدیر سیستم',
    sensitiveMfa: true,
    permissions: Object.values(PERMISSIONS),
  },
  accountant: {
    en: 'Accountant',
    fa: 'حسابدار',
    sensitiveMfa: true,
    permissions: [
      PERMISSIONS.JOURNAL_VIEW,
      PERMISSIONS.JOURNAL_CREATE_DRAFT,
      PERMISSIONS.JOURNAL_EDIT_DRAFT,
      PERMISSIONS.JOURNAL_SUBMIT,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.PERSONNEL_VIEW,
      PERMISSIONS.PERSONNEL_EDIT,
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.PAYROLL_CALCULATE,
    ],
  },
  approver: {
    en: 'Financial Approver',
    fa: 'تأییدکننده مالی',
    sensitiveMfa: true,
    permissions: [
      PERMISSIONS.JOURNAL_VIEW,
      PERMISSIONS.JOURNAL_APPROVE,
      PERMISSIONS.JOURNAL_REVERSE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.PAYROLL_APPROVE,
    ],
  },
  front_desk: {
    en: 'Front Desk',
    fa: 'پذیرش',
    sensitiveMfa: false,
    permissions: [PERMISSIONS.RESERVATION_CREATE, PERMISSIONS.ROOM_VIEW, PERMISSIONS.ROOM_MANAGE, PERMISSIONS.POS_ORDER_CREATE],
  },
};
