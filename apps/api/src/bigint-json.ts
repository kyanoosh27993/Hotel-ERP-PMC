/**
 * bigint-json.ts — سریال‌سازی BigInt (ریال) برای JSON (قاعده ۷: ممیز شناور ممنوع؛
 * پاسخ API همیشه رشته صحیح برمی‌گرداند نه عدد ممیزشناور).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (): string {
  return this.toString();
};
