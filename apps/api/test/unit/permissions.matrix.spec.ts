/**
 * permissions.matrix.spec.ts — ماتریس دسترسی قرارداد (نمونه حسابدار) باید دقیقاً اجرا شود.
 */
import { PERMISSIONS, ROLE_MATRIX } from '../../src/iam/permissions';

describe('RBAC matrix — نمونه حسابدار (قواعد امنیتی بخش ۵)', () => {
  const accountant = ROLE_MATRIX.accountant.permissions;

  it('حسابدار: مشاهده، ثبت پیش‌نویس، ویرایش پیش‌نویس، ارسال به تأیید ✓', () => {
    expect(accountant).toContain(PERMISSIONS.JOURNAL_VIEW);
    expect(accountant).toContain(PERMISSIONS.JOURNAL_CREATE_DRAFT);
    expect(accountant).toContain(PERMISSIONS.JOURNAL_EDIT_DRAFT);
    expect(accountant).toContain(PERMISSIONS.JOURNAL_SUBMIT);
  });

  it('حسابدار: تأییر نهایی ✗ — خودتأییری ممکن نیست', () => {
    expect(accountant).not.toContain(PERMISSIONS.JOURNAL_APPROVE);
  });

  it('حسابدار: برگشت سند قطعی ✗ و ویرایش حساب حساس ✗', () => {
    expect(accountant).not.toContain(PERMISSIONS.JOURNAL_REVERSE);
    expect(accountant).not.toContain(PERMISSIONS.SENSITIVE_ACCOUNTS_EDIT);
  });

  it('حسابدار: داشبورد مدیرعامل ✗', () => {
    expect(accountant).not.toContain(PERMISSIONS.DASHBOARD_CEO_VIEW);
  });

  it('تأییدکننده: تأییر ✓ ولی ثبت پیش‌نویس ✗ (جدا بودن ثبت‌کننده از تأییدکننده)', () => {
    const approver = ROLE_MATRIX.approver.permissions;
    expect(approver).toContain(PERMISSIONS.JOURNAL_APPROVE);
    expect(approver).toContain(PERMISSIONS.JOURNAL_REVERSE);
    expect(approver).not.toContain(PERMISSIONS.JOURNAL_CREATE_DRAFT);
  });

  it('نقش‌های حساس MFA می‌خواهند (admin/accountant/approver)', () => {
    expect(ROLE_MATRIX.admin.sensitiveMfa).toBe(true);
    expect(ROLE_MATRIX.accountant.sensitiveMfa).toBe(true);
    expect(ROLE_MATRIX.approver.sensitiveMfa).toBe(true);
    expect(ROLE_MATRIX.front_desk.sensitiveMfa).toBe(false);
  });

  it('admin همه مجوزها را دارد', () => {
    expect(ROLE_MATRIX.admin.permissions).toEqual(Object.values(PERMISSIONS));
  });
});
