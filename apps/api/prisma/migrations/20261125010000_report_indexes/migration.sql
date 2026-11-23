-- بهینه‌سازی گیت یکپارچه: ایندکس‌های مسیرهای گزارش‌گیری دفاتر
-- (تراز آزمایشی/دفاتر/VAT روی accountCode و postingDate+status و ترتیب docIndex)
CREATE INDEX IF NOT EXISTS ix_journal_lines_account ON "journal_lines"("accountCode");
CREATE INDEX IF NOT EXISTS ix_journal_entries_posting_status ON "journal_entries"("postingDate", "status");
CREATE INDEX IF NOT EXISTS ix_journal_entries_docindex ON "journal_entries"("docIndex");
