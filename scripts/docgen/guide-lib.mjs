// guide-lib.mjs — کتابخانهٔ مشترک تولید راهنمای کاربر (docx skill: R1 + DS-1 + toc.md + common-rules)
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, PageBreak,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel, WidthType,
  BorderStyle, ShadingType, TableOfContents, SectionType, TableLayoutType, VerticalAlign,
} from 'docx';
import fs from 'node:fs';

// ── پالت DS-1 (Deep Sea) از design-system.md ──
export const DS1 = {
  bg: '0B1C2C', accent: '529286', primaryDark: '0B1C2C', body: '000000',
  secondary: '506070',
  cover: { titleColor: 'FFFFFF', subtitleColor: 'B0B8C0', metaColor: '90989F', footerColor: '687078' },
  table: { headerBg: '529286', headerText: 'FFFFFF', accentLine: '529286', innerLine: 'BECFCC', surface: 'E8ECEB' },
};

const NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

export const FA_FONT = { ascii: 'Tahoma', hAnsi: 'Tahoma', cs: 'Tahoma', eastAsia: 'Tahoma' };
export const EN_FONT = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Times New Roman', eastAsia: 'Times New Roman' };
export const EN_HEAD_FONT = { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial', eastAsia: 'Arial' };

// ── محافظ متن (common-rules: Undefined Prevention) ──
function safeText(v, ph) {
  if (v === undefined || v === null || v === '' || String(v) === 'NaN' || String(v) === 'undefined') return ph || '【تکمیل شود】';
  return String(v);
}

// ── R1 الزامی: calcTitleLayout + splitTitleLines + calcCoverSpacing (design-system.md) ──
export function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([... '،؛،:؛!؟', ...'-_—–·/', ...' \t']);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) breakAt = charsPerLine;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += ' ' + last;
  }
  return lines;
}

export function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24, charWidthFactor = 20) {
  const charWidth = (pt) => pt * charWidthFactor;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt;
  let lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

export function calcCoverSpacing(params) {
  const {
    titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
    metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0,
  } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const remainingSpace = usableHeight - contentHeight;
  const safeRemaining = Math.max(remainingSpace, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── R1 (آینهٔ RTL برای فارسی / نسخهٔ اصلی برای انگلیسی) — معیارهای ارتفاع دست‌نخورده ──
export function buildCoverR1(config) {
  const P = config.palette;
  const rtl = !!config.rtl;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const cwf = config.charWidthFactor || 20;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 40, 24, cwf);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentBar = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  const textIndent = rtl ? { right: padR } : { left: padL };
  const metaIndent = rtl ? { right: padR + 200 } : { left: padL + 200 };
  const metaBorder = rtl ? { right: accentBar } : { left: accentBar };

  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));

  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({
        text: config.englishLabel.split('').join('  '), size: 18, color: P.accent,
        font: { ascii: 'Calibri', eastAsia: 'SimHei' }, characterSpacing: 40,
      })],
    }));
  }

  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: textIndent,
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: 'atLeast' },
      children: [new TextRun({
        text: titleLines[i], size: titleSize, sizeComplexScript: titleSize, bold: true,
        rightToLeft: rtl, color: P.cover.titleColor, font: rtl ? FA_FONT : { eastAsia: 'SimHei', ascii: 'Arial' },
      })],
    }));
  }

  if (config.subtitle) {
    children.push(new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: textIndent, spacing: { after: 800, line: Math.ceil(12 * 23), lineRule: 'atLeast' },
      children: [new TextRun({
        text: config.subtitle, size: 24, sizeComplexScript: 24, rightToLeft: rtl,
        color: P.cover.subtitleColor, font: rtl ? FA_FONT : { eastAsia: 'Microsoft YaHei', ascii: 'Arial' },
      })],
    }));
  }

  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: metaIndent, spacing: { after: 80, line: Math.ceil(10 * 23), lineRule: 'atLeast' },
      border: metaBorder,
      children: [new TextRun({
        text: safeText(line), size: 24, sizeComplexScript: 24, rightToLeft: rtl,
        color: P.cover.metaColor, font: rtl ? FA_FONT : { eastAsia: 'Microsoft YaHei', ascii: 'Arial' },
      })],
    }));
  }

  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));

  children.push(new Paragraph({
    bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || '', size: 16, color: P.cover.footerColor, font: { ascii: 'Arial' } }),
      new TextRun({ text: '                                        ' }),
      new TextRun({ text: config.footerRight || '', size: 16, sizeComplexScript: 16, rightToLeft: rtl, color: P.cover.footerColor, font: rtl ? FA_FONT : { ascii: 'Arial' } }),
    ],
  }));

  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: 'exact' },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        verticalAlign: VerticalAlign.TOP,
        children,
      })],
    })],
  })];
}

// ── سازنده‌های متن فارسی (RTL) و انگلیسی ──
export function faP(text, opts = {}) {
  const size = opts.size ?? 24;
  return new Paragraph({
    bidirectional: true,
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { line: 312, before: opts.before ?? 0, after: opts.after ?? 140 },
    children: [new TextRun({
      text: safeText(text), size, sizeComplexScript: size, rightToLeft: true,
      bold: opts.bold ?? false, color: opts.color ?? DS1.body, font: FA_FONT,
    })],
  });
}

export function faH(text, level) {
  const size = level === 1 ? 32 : level === 2 ? 28 : 24;
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    bidirectional: true, alignment: AlignmentType.RIGHT,
    spacing: { line: 312, before: level === 1 ? 360 : 240, after: level === 1 ? 160 : 120 },
    children: [new TextRun({
      text, size, sizeComplexScript: size, bold: true, rightToLeft: true,
      color: DS1.primaryDark, font: FA_FONT,
    })],
  });
}

export function enP(text, opts = {}) {
  const size = opts.size ?? 22;
  return new Paragraph({
    alignment: opts.align ?? AlignmentType.JUSTIFIED,
    spacing: { line: 312, before: opts.before ?? 0, after: opts.after ?? 120 },
    children: [new TextRun({ text: safeText(text), size, bold: opts.bold ?? false, color: opts.color ?? DS1.body, font: EN_FONT })],
  });
}

export function enH(text, level) {
  const size = level === 1 ? 30 : level === 2 ? 26 : 22;
  return new Paragraph({
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    spacing: { line: 312, before: level === 1 ? 360 : 240, after: level === 1 ? 160 : 120 },
    children: [new TextRun({ text, size, bold: true, color: DS1.primaryDark, font: EN_HEAD_FONT })],
  });
}

// ── جدول افقی (Horizontal-Only) با پشتیبانی RTL ──
export function table(headers, rows, opts = {}) {
  const rtl = !!opts.rtl;
  const widths = opts.widths ?? headers.map(() => Math.floor(100 / headers.length));
  const mk = (text, isHeader, w) => new TableCell({
    width: { size: w, type: WidthType.PERCENTAGE },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: DS1.table.headerBg } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      bidirectional: rtl, alignment: rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
      spacing: { line: 276 },
      children: [new TextRun({
        text: safeText(text), size: 20, sizeComplexScript: 20, rightToLeft: rtl, bold: isHeader,
        color: isHeader ? DS1.table.headerText : DS1.body, font: rtl ? FA_FONT : EN_FONT,
      })],
    })],
  });
  return new Table({
    visuallyRightToLeft: rtl,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: DS1.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: DS1.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: DS1.table.innerLine },
      insideVertical: NB,
    },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => mk(h, true, widths[i])) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => mk(c, false, widths[i])) })),
    ],
  });
}

// ── تصویر + زیرنویس (نسبت ابعاد حفظ می‌شود) ──
export function shot(file, caption, num, opts = {}) {
  const rtl = !!opts.rtl;
  const buf = fs.readFileSync(file);
  // ابعاد واقعی PNG از IHDR
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const displayWidth = 520;
  const displayHeight = Math.round(displayWidth * (h / w));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 160, after: 60 },
      children: [new ImageRun({ data: buf, transformation: { width: displayWidth, height: displayHeight }, type: 'png' })],
    }),
    new Paragraph({
      bidirectional: rtl, alignment: AlignmentType.CENTER, spacing: { after: 200, line: 276 },
      children: [new TextRun({
        text: `${rtl ? 'شکل' : 'Figure'} ${num} — ${caption}`,
        size: 18, sizeComplexScript: 18, rightToLeft: rtl, italics: true, color: DS1.secondary,
        font: rtl ? FA_FONT : EN_FONT,
      })],
    }),
  ];
}

// ── فوتر شماره صفحه (بدون مخرج — قانون ممنوعیت X of Y) ──
export function pageFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { line: 240 },
      children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: DS1.secondary, font: { ascii: 'Arial' } })],
    })],
  });
}

export function pageHeaderFa(title) {
  return new Header({
    children: [new Paragraph({
      bidirectional: true, alignment: AlignmentType.CENTER, spacing: { line: 240, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: DS1.table.innerLine, space: 4 } },
      children: [new TextRun({ text: title, size: 16, sizeComplexScript: 16, rightToLeft: true, color: DS1.secondary, font: FA_FONT })],
    })],
  });
}

export { Document, Packer, Paragraph, TextRun, TableOfContents, PageBreak, AlignmentType, SectionType, NumberFormat, HeadingLevel };
