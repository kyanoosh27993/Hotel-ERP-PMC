#!/usr/bin/env python3
# postprocess-docx.py — پس‌پردازش WPS (toc.md): پچ instrText فوترها + حذف pgNumType خالی جلد
# کاربرد: python3 postprocess-docx.py <file.docx> <roman_footer> <arabic_footer>
import sys, re, zipfile, shutil, os

def main():
    path, roman_footer, arabic_footer = sys.argv[1], sys.argv[2], sys.argv[3]
    tmp = path + '.tmp'
    zin = zipfile.ZipFile(path, 'r')
    doc = zin.read('word/document.xml').decode('utf-8')
    rels = zin.read('word/_rels/document.xml.rels').decode('utf-8')

    # ۱) حذف pgNumType خالی (جلد)
    doc2 = doc.replace('<w:pgNumType/>', '')

    # ۲) نگاشت rId → فایل فوتر و ترتیب بخش‌ها
    rid_to_file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))
    # sectPr ها به ترتیب سند — footerReference هر بخش
    sect_footer_rids = []
    for sect in re.findall(r'<w:sectPr.*?</w:sectPr>', doc2, re.S):
        m = re.search(r'<w:footerReference[^>]*w:type="default"[^>]*r:id="(rId\d+)"', sect)
        sect_footer_rids.append(m.group(1) if m else None)
    # بخش‌ها: [جلد(None), رومی, اعرابی] — فوتر یکسان برای هر دو بخش ۲/۳ جدا ساخته شده‌اند
    files = [rid_to_file.get(r) for r in sect_footer_rids if r]
    # فوترِ اولِ موجود → رومی، دوم → اعرابی
    patches = {}
    if len(files) >= 1 and files[0]: patches[files[0]] = 'ROMAN'
    if len(files) >= 2 and files[1]: patches[files[1]] = 'arabic'
    print('sections footers:', sect_footer_rids, '→', patches)

    zout = zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml':
            data = doc2.encode('utf-8')
        elif item.filename.startswith('word/footer') and item.filename.endswith('.xml'):
            fmt = patches.get(item.filename.split('/')[-1])
            if fmt:
                x = data.decode('utf-8')
                x = re.sub(r'(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)',
                           rf'\g<1> PAGE \\* {fmt} \\* MERGEFORMAT \g<2>', x)
                data = x.encode('utf-8')
        zout.writestr(item, data)
    zout.close(); zin.close()
    shutil.move(tmp, path)
    print('postprocess done:', os.path.basename(path))

if __name__ == '__main__':
    main()
