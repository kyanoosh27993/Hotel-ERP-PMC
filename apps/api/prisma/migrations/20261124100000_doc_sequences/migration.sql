-- مهاجرت اصلاحی تست زنده — توالی‌های شماره‌گذاری اسناد
-- الگوی قبلی count()+1 در هم‌روندی باعث تداخل شماره و ۵۰۰ می‌شد (۶ از ۸ سفارش هم‌زمان).
CREATE SEQUENCE IF NOT EXISTS seq_reservation;
CREATE SEQUENCE IF NOT EXISTS seq_stay;
CREATE SEQUENCE IF NOT EXISTS seq_rest_order;
CREATE SEQUENCE IF NOT EXISTS seq_kitchen_ticket;
CREATE SEQUENCE IF NOT EXISTS seq_pos_order;
CREATE SEQUENCE IF NOT EXISTS seq_anc_order;
CREATE SEQUENCE IF NOT EXISTS seq_shift;
CREATE SEQUENCE IF NOT EXISTS seq_cash_txn;
CREATE SEQUENCE IF NOT EXISTS seq_req;
CREATE SEQUENCE IF NOT EXISTS seq_po;
CREATE SEQUENCE IF NOT EXISTS seq_grn;
CREATE SEQUENCE IF NOT EXISTS seq_stock_count;
CREATE SEQUENCE IF NOT EXISTS seq_maintenance;
CREATE SEQUENCE IF NOT EXISTS seq_laundry;
CREATE SEQUENCE IF NOT EXISTS seq_lostfound;
CREATE SEQUENCE IF NOT EXISTS seq_asset;
-- شروع توالی‌ها از ۱ پس از deploy: پیشوند سال در کدها مانع تداخل با دادهٔ قبل است؛
-- شکاف عددی بین اسناد پذیرفتنی است (قواعد سند: یکتایی مهم است نه پیوستگی).
