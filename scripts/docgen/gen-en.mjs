// gen-en.mjs — End-user documentation, English edition (Phase 12 / F12-T3) — R1/DS-1, LTR, TOC
import {
  Document, Packer, Paragraph, TextRun, TableOfContents, PageBreak, AlignmentType, SectionType, NumberFormat,
  enP, enH, table, shot, pageFooter, buildCoverR1, DS1, EN_FONT,
} from './guide-lib.mjs';
import fs from 'node:fs';

const IMG = '/home/z/my-project/hotel-erp/docs/17-user-guide/img';
const OUT = '/home/z/my-project/hotel-erp/docs/17-user-guide/Hotel-ERP-User-Guide-EN.docx';
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1701, right: 1417 };

const body = [];

// 1. Introduction
body.push(enH('1. Introduction', 1));
body.push(enP('This document is the official end-user guide for the Hotel ERP platform, version 0.11, covering every module delivered in phases 0 through 11. Its purpose is practical: each role — front desk, housekeeping, restaurant, treasury, accounting, approval and management — should be able to find its daily tasks here and follow them step by step without technical assistance. Every section first explains when and why a module is used, then walks through the actual screens with real screenshots.'));
body.push(enP('The platform is offline-first: critical front-desk and cash operations continue during network outages, and data synchronises once connectivity returns. All monetary amounts are stored in Iranian Rials with exact integer precision, and dates are displayed in the Persian (Jalali) calendar. Consequently, every number shown on screen matches the posted accounting entries and the figures reported to the tax authorities. A complete Persian edition of this guide is available as Hotel-ERP-User-Guide-FA.docx in the same folder.'));

// 2. Getting started
body.push(enH('2. Getting Started: Sign-in, Roles and Security', 1));
body.push(enH('2.1 Signing in', 2));
body.push(enP('Enter the API base address (for example http://localhost:3000/api/v1), your username, password and — for sensitive roles — the current TOTP code in the sign-in form of any module or the Settings module. The token is kept in browser memory until it expires, so re-authentication is rarely needed during a shift. On shared terminals, always sign out or clear browser storage at the end of your shift so the token does not survive you.'));
body.push(enP('Financially sensitive roles (accountant, approver, administrator) require two-factor authentication with a TOTP code that refreshes every 30 seconds in an authenticator app. A wrong code produces a login error, and failed attempts are recorded in the audit trail. Password changes and resets are handled by the system administrator only.'));
body.push(enH('2.2 Roles and permissions', 2));
body.push(enP('The table below summarises what each role can reach. The governing principle is separation of duties: no user can both create and finally approve the same document, and no amount becomes final without a recorded human approval.'));
body.push(table(
  ['Role', 'Main modules', 'Typical restriction'],
  [
    ['Administrator', 'All modules plus settings and users', 'Final document approval (separation of duties)'],
    ['Accountant', 'Draft entries, treasury, payroll, taxes, BI', 'Final approval and declaration submission'],
    ['Financial approver', 'Approvals, treasury, depreciation, all reports', 'Creating new draft entries'],
    ['Front desk', 'Room map, reservations, ancillary orders, restaurant', 'Financial documents and payroll'],
    ['Housekeeping', 'Room status, linen, maintenance', 'Financial entries and rate changes'],
    ['Procurement / stores', 'Purchase requests and orders, stores, cost control', 'Final purchase approval'],
  ],
  { widths: [20, 45, 35] },
));
body.push(enP('A 403 error means your current role lacks the permission for that action — ask the administrator. A 401 error means your token has expired and you should sign in again.', { after: 200 }));

// 3. Modules
body.push(enH('3. Module Guide', 1));
body.push(enH('3.1 Management dashboard — offline analysis', 2));
body.push(enP('The manager dashboard condenses the day into one screen: occupancy, revenue, room status, open orders and a seven-day trend chart. A rule-based, fully offline analysis engine writes short Persian findings under the chart — for example, occupancy drops compared with last week, or a cluster of housekeeping requests. Every number comes from live platform data, never from an external model.'));
body.push(...shot(`${IMG}/dashboard.png`, 'Manager dashboard — daily summary and offline analysis', 1));
body.push(enH('3.2 Front desk — room map and stays', 2));
body.push(enP('The room map is the front-desk home screen; room colours show status (vacant clean, vacant dirty, occupied, cleaning, out of service). Clicking a room opens its actions: check-in, checkout and settlement, cleaning status change, or stay details. Telephone reservations are created from the same screen so the room is blocked for future dates. Settlement must bring the stay balance to zero before the stay can close.'));
body.push(...shot(`${IMG}/frontdesk.png`, 'Room map — colour-coded rooms and front-desk actions', 2));
body.push(enH('3.3 Housekeeping, fixed assets and ancillary services', 2));
body.push(enP('Housekeeping staff take the cleaning list from the Housekeeping module and flip rooms to clean when finished; broken items become maintenance requests that reach the technical team directly. Linen movements are recorded per room so the linen balance stays exact at checkout. The Fixed Assets module tracks each asset from purchase through monthly depreciation, and the Ancillary module takes guest orders (taxi, laundry, catering) and links them to the corresponding revenue entry.'));
body.push(enH('3.4 Restaurant and kitchen', 2));
body.push(enP('The restaurant module opens table orders and sends every line to the kitchen display (KDS), where tickets queue in arrival order until marked ready. End-of-shift cash closing compares food sales against collected cash and records the difference as variance; variances beyond the allowed threshold are flagged by the BI anomaly scanner.'));
body.push(...shot(`${IMG}/restaurant.png`, 'Restaurant — orders and cash variance control', 3));
body.push(enH('3.5 Treasury and cash', 2));
body.push(enP('Treasury records cash and bank receipts and payments; each row enters the reconciliation queue after posting. Bank reconciliation matches the ledger balance to the bank statement, and differences are explained and approved as reconciliation items. The cash box must never go negative — the platform accepts the posting but raises a critical anomaly in the BI scanner.'));
body.push(...shot(`${IMG}/treasury.png`, 'Treasury — receipts, payments and bank reconciliation', 4));
body.push(enH('3.6 Accounting and the approval workflow', 2));
body.push(enP('Every financial event lands in an accounting entry. Manual entries start as drafts and only become final after approval through the workflow module, where the approver confirms, rejects or requests correction — every decision recorded with user and timestamp. Posted documents can never be edited; corrections go through controlled reversal entries.'));
body.push(...shot(`${IMG}/workflow.png`, 'Approval workflow — entry queue and decisions', 5));
body.push(enH('3.7 Tax: e-invoicing, quarterly transactions and VAT', 2));
body.push(enP('The Moadian module builds quarterly electronic invoices, shows terminal status and produces the standard submission file for the Iranian e-invoice system; final submission always requires human approval. The Quarterly module registers off-platform transactions (manual sales, POS, exempt) per Persian quarter and exports the standard tax-administration file. Its VAT declaration panel computes output tax (account 2201), input credit (2204), net payable and the tax base for any date range, broken down by cost centre — the basis for completing the VAT return.'));
body.push(...shot(`${IMG}/moadian.png`, 'E-invoicing (Moadian) — quarterly status and submission', 6));
body.push(...shot(`${IMG}/quarterly.png`, 'Quarterly transactions and VAT declaration by cost centre', 7));
body.push(enP('The Direct Tax module keeps the annual performance plan (capacity, target occupancy, target revenue), computes the Article 105 return from posted entries, and maintains counterparty registry entries. Like all tax modules, submission goes through the human approval workflow.'));
body.push(enH('3.8 Payroll, purchasing and stores', 2));
body.push(enP('Payroll builds the monthly period, applies earning and deduction items, and hands the net payment to accounting as a draft entry that the accountant must approve. Procurement covers the request-to-order-to-receipt cycle, and Stores manage stock, issues and kitchen cost control, including per-item minimum levels that surface in reports.'));
body.push(enH('3.9 Business intelligence and AI (phase 11)', 2));
body.push(enP('The BI module offers six offline, rule-based tools: budget-versus-actual by cost centre, a Persian-language manager assistant whose every answer cites its data source, a 13-week cash-flow forecast with deficit warnings, smart document drafting from pasted invoice text, room-rate suggestions with confidence bands, and a financial anomaly scanner with event sentiment analysis. By design, every AI output is a draft or a suggestion and never becomes final without human approval.'));
body.push(...shot(`${IMG}/bi.png`, 'BI and AI — budget variance, manager assistant, forecasts', 8));
body.push(enP('Sign in from the module connection panel as accountant or administrator, record the period budget, then load department variances. Try the assistant with questions such as today\'s occupancy or the cash balance — each answer labels its source so you can trace the figure back to the journal.'));

// 4. Scenarios
body.push(enH('4. Common Shift Scenarios', 1));
body.push(enH('4.1 Front-desk morning shift', 2));
body.push(enP('1) Sign in and review the room map; 2) review today\'s departures and take settlements; 3) check in arrivals and deposit guarantees in the cash box; 4) notify housekeeping of vacated rooms; 5) at shift end, reconcile cash collections with the system records.'));
body.push(enH('4.2 Month-end accounting', 2));
body.push(enP('1) Clear pending drafts through the approval workflow; 2) run monthly asset depreciation; 3) compute and post payroll; 4) complete bank reconciliation; 5) review BI anomalies and explain open items; 6) lock the fiscal period in settings so month data can no longer change.'));
body.push(enH('4.3 Quarter-end tax cycle', 2));
body.push(enP('1) Extract and submit e-invoices with human approval; 2) register off-platform transactions and take the standard file; 3) compute the VAT declaration from its panel and carry the figures to the tax portal; 4) request quarter close through the workflow.'));

// 5. Troubleshooting
body.push(enH('5. Troubleshooting and Support', 1));
body.push(enP('Review the table below before contacting support; most common messages have a specific meaning and a user-level remedy. During connectivity loss, front-desk and cash operations continue offline and only management reporting syncs later.'));
body.push(table(
  ['Message / state', 'Meaning', 'Action'],
  [
    ['Error 401', 'Token expired or invalid', 'Sign in again'],
    ['Error 403', 'Role lacks permission', 'Request access from administrator'],
    ['Error 409 (period locked)', 'Fiscal period is locked', 'Post in the next period or ask admin to unlock'],
    ['Error 409 (quarter closed)', 'Tax quarter closed', 'Correct via controlled reversal and reopen'],
    ['Entry stuck in approval', 'Approver has not decided', 'Follow up in the workflow module'],
    ['Server unreachable', 'Service or network down', 'Continue critical operations offline, inform IT'],
  ],
  { widths: [28, 34, 38] },
));
body.push(enP('When reporting a defect, include the module name, exact time, username and the full error text — all of which are also recorded in the platform audit trail. This guide is updated with every delivery wave; the current edition matches platform version 0.11 (phase 11).'));

// TOC section
const tocChildren = [
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360, line: 400, lineRule: 'atLeast' },
    children: [new TextRun({ text: 'Table of Contents', size: 32, bold: true, color: DS1.primaryDark, font: { ascii: 'Arial' } })],
  }),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  new Paragraph({
    spacing: { before: 200, line: 276 },
    children: [new TextRun({
      text: 'Note: this table is generated with field codes — after editing, right-click it and choose "Update Field" to refresh page numbers.',
      size: 18, italics: true, color: '888888', font: EN_FONT,
    })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: EN_FONT, size: 22, color: DS1.body }, paragraph: { spacing: { line: 312 } } },
      heading1: { run: { font: { ascii: 'Arial' }, size: 30, bold: true, color: DS1.primaryDark }, paragraph: { spacing: { before: 360, after: 160, line: 312 }, outlineLevel: 0 } },
      heading2: { run: { font: { ascii: 'Arial' }, size: 26, bold: true, color: DS1.primaryDark }, paragraph: { spacing: { before: 240, after: 120, line: 312 }, outlineLevel: 1 } },
    },
  },
  sections: [
    { properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: 'Hotel ERP — End-User Documentation',
        subtitle: 'Role-based user guide — version 0.11 (phases 0–11)',
        englishLabel: 'HOTEL ERP USER GUIDE',
        metaLines: ['Release: November 2026 — matching platform 0.11', 'Audience: front desk, housekeeping, restaurant, treasury, accounting, approver, admin', 'Classification: client document — confidential'],
        footerLeft: 'Hotel ERP — 0.11.0', footerRight: 'End-User Documentation',
        charWidthFactor: 11,
        palette: { bg: DS1.bg, accent: DS1.accent, cover: DS1.cover, titleColor: DS1.cover.titleColor, subtitleColor: DS1.cover.subtitleColor, metaColor: DS1.cover.metaColor, footerColor: DS1.cover.footerColor },
      }) },
    { properties: { type: SectionType.NEXT_PAGE, page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } } },
      footers: { default: pageFooter() }, children: tocChildren },
    { properties: { type: SectionType.NEXT_PAGE, page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      footers: { default: pageFooter() }, children: body },
  ],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log('EN guide written:', OUT, buf.length, 'bytes');
