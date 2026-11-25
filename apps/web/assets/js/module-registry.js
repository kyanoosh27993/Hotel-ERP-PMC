/**
 * module-registry.js — U0/U2 رجیستری ماژول‌ها: تک منبع حقیقت گرید صفحهٔ اصلی
 * نگاشت یک‌به‌یک با صفحهٔ اصلی (docs/PLAN-ui-legacy.md §۱.۲):
 * دسته front (۸) | back (۶) | other (۷) — آیکن‌ها از apps/web/assets/icons/ui/
 * view: مقصد کلیک — ماژول موجود یا stub فاز بعدی.
 */
(function (global) {
  'use strict';

  var ICON = 'assets/icons/ui/';

  var REGISTRY = [
    /* ── فرانت‌آفیس (۸) — ترتیب مرجع ── */
    { id: 'reception',       cat: 'front', icon: 'reception.png',            label: 'پذیرش',            view: 'reception',      ready: true },
    { id: 'cashier',         cat: 'front', icon: 'cashier.png',              label: 'صندوق',            view: 'treasury',       ready: true },
    { id: 'reservation',     cat: 'front', icon: 'reservation.png',          label: 'رزرواسیون',        view: 'frontdesk',      ready: true },
    { id: 'restaurant',      cat: 'front', icon: 'resturant.png',            label: 'رستوران',          view: 'restaurant',     ready: true },
    { id: 'housekeeping',    cat: 'front', icon: 'housekeeping.png',         label: 'خانه داری',        view: 'housekeepingops', ready: true },
    { id: 'roomssetup',      cat: 'front', icon: '../rx-reception/room_rack.png', label: 'تنظیم اتاق‌ها', view: 'roomssetup', ready: true },
    { id: 'laundry',         cat: 'front', icon: 'lundary.png',              label: 'لاندری',           view: 'stub:laundry',   ready: false, phase: 'R-خدمات' },
    { id: 'telephone',       cat: 'front', icon: 'telephone.png',            label: 'تلفن',             view: 'stub:telephone', ready: false, phase: 'R-خدمات' },
    { id: 'ceremonies',      cat: 'front', icon: 'cermonism.png',            label: 'تشریفات',          view: 'stub:ceremonies', ready: false, phase: 'R-خدمات' },
    /* ── بک‌آفیس (۶) ── */
    { id: 'mngreports',      cat: 'back',  icon: 'gozareshate_modiriaty.png', label: 'گزارشات مدیریت',  view: 'bi',             ready: true },
    { id: 'assets',          cat: 'back',  icon: 'hsb_amval.png',            label: 'اموال',            view: 'assets',         ready: true },
    { id: 'payroll',         cat: 'back',  icon: 'payroll.png',              label: 'حقوق و دستمزد',    view: 'payroll',        ready: true },
    { id: 'costcontrol',     cat: 'back',  icon: 'cost.png',                 label: 'کاست کنترل',       view: 'stores',         ready: true },
    { id: 'storage',         cat: 'back',  icon: 'storage.png',              label: 'انبار داری',       view: 'stores',         ready: true },
    { id: 'engineering',     cat: 'back',  icon: 'enginering.png',           label: 'مهندسی تاسیسات',   view: 'housekeepingops', ready: true },
    /* ── خدمات جانبی (۷) ── */
    { id: 'shop',            cat: 'other', icon: 'shop2.png',                label: 'فروشگاه اینترنتی', view: 'stub:shop',      ready: false, phase: 'R-خدمات' },
    { id: 'consumption',     cat: 'other', icon: 'masaref.png',              label: 'مصارف و درخواستها', view: 'workflow',      ready: true },
    { id: 'keycard',         cat: 'other', icon: 'key_card.png',             label: 'کلید کارت',        view: 'stub:keycard',   ready: false, phase: 'R-خدمات' },
    { id: 'crm',             cat: 'other', icon: 'crm.png',                  label: 'خدمات مشتریان',    view: 'ancillary',      ready: true },
    { id: 'paperless',       cat: 'other', icon: 'paperless.png',            label: 'مکاتبات داخلی',    view: 'workflow',       ready: true },
    { id: 'poolclub',        cat: 'other', icon: 'poolclub.png',             label: 'مجموعه آبی',       view: 'stub:poolclub',  ready: false, phase: 'R-خدمات' },
    { id: 'portal',          cat: 'other', icon: 'portal.jpg',               label: 'پورتال پرسنلی',    view: 'ancillary',      ready: true },
  ];

  global.ModuleRegistry = {
    all: function () { return REGISTRY.slice(); },
    byCat: function (cat) { return REGISTRY.filter(function (m) { return m.cat === cat; }); },
    iconUrl: function (m) { return ICON + m.icon; },
  };
})(window);
