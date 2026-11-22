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
  // فاز ۴ — PMS: نقشه اتاق، رزرو، پذیرش، خانه‌داری، حسابرسی شبانه
  RESERVATION_VIEW: 'reservation.view',
  ROOM_UPDATE: 'room.update',
  STAY_CHECKIN: 'stay.checkin',
  STAY_CHECKOUT: 'stay.checkout',
  HOUSEKEEPING_UPDATE: 'housekeeping.update',
  NIGHT_AUDIT_RUN: 'nightaudit.run',
  // موج ۱ — فاز ۵: صندوق، پرداخت و خزانه‌داری
  TREASURY_VIEW: 'treasury.view',
  TREASURY_TXN_CREATE: 'treasury.txn.create',
  TREASURY_SHIFT_MANAGE: 'treasury.shift.manage',
  TREASURY_VOID: 'treasury.void',
  TREASURY_RECONCILE: 'treasury.reconcile',
  // موج ۱ — فاز ۱۰: خانه‌داری کامل، تعمیرات، لاندری، اشیای جامانده، دارایی، خدمات جانبی
  HOUSEKEEPING_TASK: 'housekeeping.task',
  HOUSEKEEPING_INSPECT: 'housekeeping.inspect',
  MAINTENANCE_REPORT: 'maintenance.report',
  MAINTENANCE_MANAGE: 'maintenance.manage',
  LAUNDRY_MANAGE: 'laundry.manage',
  LOSTFOUND_MANAGE: 'lostfound.manage',
  ASSET_VIEW: 'asset.view',
  ASSET_MANAGE: 'asset.manage',
  ASSET_DEPRECIATE: 'asset.depreciate',
  ANCILLARY_ORDER: 'ancillary.order',
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
  { code: PERMISSIONS.POS_ORDER_CREATE, en: 'Create POS orders', fa: 'ثبت سفارش POS' },
  { code: PERMISSIONS.INTEGRATIONS_VIEW, en: 'View integrations', fa: 'مشاهده یکپارچگی‌ها' },
  { code: PERMISSIONS.DASHBOARD_CEO_VIEW, en: 'View CEO dashboard', fa: 'مشاهده داشبورد مدیرعامل' },
  { code: PERMISSIONS.AUDIT_VIEW, en: 'View audit logs', fa: 'مشاهده لاگ حسابرسی' },
  { code: PERMISSIONS.PERSONNEL_VIEW, en: 'View personnel records', fa: 'مشاهده پرونده پرسنلی' },
  { code: PERMISSIONS.PERSONNEL_EDIT, en: 'Create/edit personnel and decisions', fa: 'ثبت/ویرایش پرسنل و احکام' },
  { code: PERMISSIONS.PAYROLL_VIEW, en: 'View payroll runs and lists', fa: 'مشاهده دوره‌های حقوق و لیست‌ها' },
  { code: PERMISSIONS.PAYROLL_CALCULATE, en: 'Calculate payroll runs', fa: 'محاسبه دوره حقوق' },
  { code: PERMISSIONS.PAYROLL_APPROVE, en: 'Approve payroll runs and decisions', fa: 'تأیید احکام و دوره حقوق' },
  // فاز ۴ — PMS
  { code: PERMISSIONS.RESERVATION_VIEW, en: 'View reservations and waitlist', fa: 'مشاهده رزروها و لیست انتظار' },
  { code: PERMISSIONS.ROOM_UPDATE, en: 'Update room status and maintenance', fa: 'تغییر وضعیت اتاق و تعمیرات' },
  { code: PERMISSIONS.STAY_CHECKIN, en: 'Check guests in', fa: 'ثبت ورود مهمان (پذیرش)' },
  { code: PERMISSIONS.STAY_CHECKOUT, en: 'Check guests out', fa: 'ثبت خروج مهمان (تسویه)' },
  { code: PERMISSIONS.HOUSEKEEPING_UPDATE, en: 'Update housekeeping status', fa: 'به‌روزرسانی وضعیت نظافت اتاق' },
  { code: PERMISSIONS.NIGHT_AUDIT_RUN, en: 'Run night audit', fa: 'اجرای حسابرسی شبانه' },
  // موج ۱ — فاز ۵
  { code: PERMISSIONS.TREASURY_VIEW, en: 'View cash accounts, shifts and transactions', fa: 'مشاهده صندوق‌ها، شیفت‌ها و تراکنش‌ها' },
  { code: PERMISSIONS.TREASURY_TXN_CREATE, en: 'Post treasury transactions', fa: 'ثبت دریافت/پرداخت/انتقال' },
  { code: PERMISSIONS.TREASURY_SHIFT_MANAGE, en: 'Open/close cashier shifts', fa: 'باز/بستن شیفت صندوق' },
  { code: PERMISSIONS.TREASURY_VOID, en: 'Void treasury transactions', fa: 'ابطال تراکنش خزانه' },
  { code: PERMISSIONS.TREASURY_RECONCILE, en: 'Import bank statements and reconcile', fa: 'ورود صورت‌حساب بانک و مغایرت‌گیری' },
  // موج ۱ — فاز ۱۰
  { code: PERMISSIONS.HOUSEKEEPING_TASK, en: 'Assign and complete housekeeping tasks', fa: 'تخصیص و انجام وظایف خانه‌داری' },
  { code: PERMISSIONS.HOUSEKEEPING_INSPECT, en: 'Record room inspections', fa: 'ثبت بازرسی اتاق' },
  { code: PERMISSIONS.MAINTENANCE_REPORT, en: 'Report maintenance issues', fa: 'ثبت درخواست تعمیر' },
  { code: PERMISSIONS.MAINTENANCE_MANAGE, en: 'Assign and close maintenance requests', fa: 'تخصیص و بستن درخواست تعمیر' },
  { code: PERMISSIONS.LAUNDRY_MANAGE, en: 'Manage laundry batches and linen', fa: 'مدیریت بچ‌های لاندری و ملحفه' },
  { code: PERMISSIONS.LOSTFOUND_MANAGE, en: 'Manage lost and found items', fa: 'مدیریت اشیای جامانده' },
  { code: PERMISSIONS.ASSET_VIEW, en: 'View fixed assets and depreciation', fa: 'مشاهده دارایی ثابت و استهلاک' },
  { code: PERMISSIONS.ASSET_MANAGE, en: 'Register/transfer/dispose assets', fa: 'ثبت/انتقال/اسقاط دارایی' },
  { code: PERMISSIONS.ASSET_DEPRECIATE, en: 'Run depreciation for a period', fa: 'ثبت استهلاک دوره' },
  { code: PERMISSIONS.ANCILLARY_ORDER, en: 'Confirm ancillary service orders', fa: 'ثبت سفارش خدمات جانبی' },
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
      // موج ۱ — فاز ۵/۱۰
      PERMISSIONS.TREASURY_VIEW,
      PERMISSIONS.TREASURY_RECONCILE,
      PERMISSIONS.ASSET_VIEW,
      PERMISSIONS.ANCILLARY_ORDER,
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
      // موج ۱ — فاز ۵/۱۰
      PERMISSIONS.TREASURY_VIEW,
      PERMISSIONS.TREASURY_VOID,
      PERMISSIONS.ASSET_VIEW,
      PERMISSIONS.ASSET_DEPRECIATE,
    ],
  },
  front_desk: {
    en: 'Front Desk',
    fa: 'پذیرش',
    sensitiveMfa: false,
    permissions: [
      PERMISSIONS.RESERVATION_CREATE,
      PERMISSIONS.RESERVATION_VIEW,
      PERMISSIONS.ROOM_VIEW,
      PERMISSIONS.ROOM_UPDATE,
      PERMISSIONS.STAY_CHECKIN,
      PERMISSIONS.STAY_CHECKOUT,
      PERMISSIONS.POS_ORDER_CREATE,
      PERMISSIONS.NIGHT_AUDIT_RUN,
      // موج ۱ — فاز ۵/۱۰
      PERMISSIONS.TREASURY_VIEW,
      PERMISSIONS.TREASURY_TXN_CREATE,
      PERMISSIONS.TREASURY_SHIFT_MANAGE,
      PERMISSIONS.ANCILLARY_ORDER,
      PERMISSIONS.MAINTENANCE_REPORT,
      PERMISSIONS.LOSTFOUND_MANAGE,
    ],
  },
  housekeeper: {
    en: 'Housekeeping',
    fa: 'خانه‌داری',
    sensitiveMfa: false,
    permissions: [
      PERMISSIONS.ROOM_VIEW,
      PERMISSIONS.HOUSEKEEPING_UPDATE,
      // موج ۱ — فاز ۱۰
      PERMISSIONS.HOUSEKEEPING_TASK,
      PERMISSIONS.HOUSEKEEPING_INSPECT,
      PERMISSIONS.LAUNDRY_MANAGE,
      PERMISSIONS.MAINTENANCE_REPORT,
      PERMISSIONS.LOSTFOUND_MANAGE,
    ],
  },
  cashier: {
    en: 'Cashier',
    fa: 'صندوق‌دار',
    sensitiveMfa: false,
    permissions: [
      PERMISSIONS.TREASURY_VIEW,
      PERMISSIONS.TREASURY_TXN_CREATE,
      PERMISSIONS.TREASURY_SHIFT_MANAGE,
    ],
  },
};
