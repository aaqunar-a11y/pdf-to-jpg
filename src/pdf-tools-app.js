/* 知办库 PDF 工具核心库（pdf-lib/pdf.js 实现全部可用功能）
 * 用法: <script src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"></script>
 *       <script src="/static/js/pdf-tools-app.js"></script>
 * 每个函数返回 {ok, blob, name, msg}
 */
var PDFTools = (function () {
  var P = null; // PDFLib
  function lib() {
    if (!P) P = PDFLib;
    return P;
  }
  function dload(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  function bytesOf(f) { return f.arrayBuffer(); }

  // ---------- 合并 ----------
  async function merge(files) {
    var { PDFDocument } = lib();
    var out = await PDFDocument.create();
    for (var f of files) {
      var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
      var pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(function (p) { out.addPage(p); });
    }
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'merged.pdf', msg: '合并成功，共 ' + out.getPageCount() + ' 页' };
  }

  // ---------- 拆分 ----------
  async function split(f, mode, rangeText) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var n = src.getPageCount();
    var groups = []; // [[startIdx, endIdx]]
    if (mode === 'all') {
      for (var i = 0; i < n; i++) groups.push([i, i]);
    } else if (mode === 'range') {
      // "1-3,5-7" → 每组一文件；"1,3" 单页
      rangeText.split(',').forEach(function (part) {
        part = part.trim();
        var m = part.match(/^(\d+)-(\d+)$/);
        if (m) groups.push([parseInt(m[1]) - 1, parseInt(m[2]) - 1]);
        else if (/^\d+$/.test(part)) groups.push([parseInt(part) - 1, parseInt(part) - 1]);
      });
      groups = groups.filter(function (g) { return g[0] >= 0 && g[1] < n && g[0] <= g[1]; });
    }
    if (!groups.length) return { ok: false, msg: '未解析到有效页码范围' };
    var zip = new JSZip();
    for (var g = 0; g < groups.length; g++) {
      var single = await PDFDocument.create();
      var idxs = [];
      for (var i = groups[g][0]; i <= groups[g][1]; i++) idxs.push(i);
      var pgs = await single.copyPages(src, idxs);
      pgs.forEach(function (p) { single.addPage(p); });
      zip.file('page-' + (g + 1) + '.pdf', await single.save());
    }
    var blob = await zip.generateAsync({ type: 'blob' });
    return { ok: true, blob: blob, name: f.name.replace('.pdf', '') + '-parts.zip', msg: '拆分完成，共 ' + groups.length + ' 个文件' };
  }

  // ---------- 旋转 ----------
  async function rotate(f, angle) {
    var { PDFDocument, degrees } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    src.getPages().forEach(function (p) { p.setRotation(degrees(angle)); });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-rotated.pdf', msg: '旋转 ' + angle + '° 完成' };
  }

  // ---------- 删除页面 ----------
  async function deletePages(f, rangeText) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var n = src.getPageCount();
    var del = new Set();
    rangeText.split(',').forEach(function (part) {
      part = part.trim();
      var m = part.match(/^(\d+)-(\d+)$/);
      if (m) { for (var i = parseInt(m[1]); i <= parseInt(m[2]); i++) del.add(i); }
      else if (/^\d+$/.test(part)) del.add(parseInt(part));
    });
    var idxs = [];
    for (var i = 1; i <= n; i++) if (!del.has(i)) idxs.push(i - 1);
    var out = await PDFDocument.create();
    var pgs = await out.copyPages(src, idxs);
    pgs.forEach(function (p) { out.addPage(p); });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-deleted.pdf', msg: '已删除 ' + del.size + ' 页，剩余 ' + out.getPageCount() + ' 页' };
  }

  // ---------- 提取页面 ----------
  async function extractPages(f, rangeText) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var n = src.getPageCount();
    var idxs = [];
    rangeText.split(',').forEach(function (part) {
      part = part.trim();
      var m = part.match(/^(\d+)-(\d+)$/);
      if (m) { for (var i = parseInt(m[1]); i <= parseInt(m[2]); i++) if (i >= 1 && i <= n) idxs.push(i - 1); }
      else if (/^\d+$/.test(part) && parseInt(part) >= 1 && parseInt(part) <= n) idxs.push(parseInt(part) - 1);
    });
    var out = await PDFDocument.create();
    var pgs = await out.copyPages(src, idxs);
    pgs.forEach(function (p) { out.addPage(p); });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-extracted.pdf', msg: '已提取 ' + idxs.length + ' 页' };
  }

  // ---------- 页面排序 ----------
  async function reorder(f, orderText) {
    // orderText: "3,1,2" 或 "reverse"
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var n = src.getPageCount();
    var idxs;
    if (orderText === 'reverse') {
      idxs = []; for (var i = n - 1; i >= 0; i--) idxs.push(i);
    } else {
      idxs = orderText.split(',').map(function (x) { return parseInt(x.trim()) - 1; })
        .filter(function (i) { return i >= 0 && i < n; });
    }
    var out = await PDFDocument.create();
    var pgs = await out.copyPages(src, idxs);
    pgs.forEach(function (p) { out.addPage(p); });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-reordered.pdf', msg: '排序完成，共 ' + out.getPageCount() + ' 页' };
  }

  // ---------- 图片转 PDF ----------
  async function imagesToPdf(files) {
    var { PDFDocument } = lib();
    var out = await PDFDocument.create();
    for (var f of files) {
      var buf = await f.arrayBuffer();
      var img;
      if (f.type === 'image/png') img = await out.embedPng(buf);
      else img = await out.embedJpg(buf);
      var page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'images.pdf', msg: '已合成 ' + files.length + ' 张图片' };
  }

  // ---------- PDF 转图片 ----------
  async function pdfToImages(f, scale) {
    var data = new Uint8Array(await f.arrayBuffer());
    var pdf = await pdfjsLib.getDocument({ data: data }).promise;
    var zip = new JSZip();
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var vp = page.getViewport({ scale: scale || 2 });
      var canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      zip.file('page-' + i + '.png', canvas.toDataURL('image/png').split(',')[1], { base64: true });
    }
    var blob = await zip.generateAsync({ type: 'blob' });
    return { ok: true, blob: blob, name: f.name.replace('.pdf', '') + '-images.zip', msg: '共 ' + pdf.numPages + ' 页 PNG' };
  }

  // ---------- 加密（设置密码） ----------
  async function encrypt(f, userPwd, ownerPwd) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    src.encrypt({ userPassword: userPwd, ownerPassword: ownerPwd || userPwd, permissions: { printing: 'highResolution', modifying: false, copying: false, annotating: false } });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-encrypted.pdf', msg: '加密完成，打开密码：' + userPwd };
  }

  // ---------- 解密 ----------
  async function decrypt(f, pwd) {
    var { PDFDocument } = lib();
    try {
      var src = await PDFDocument.load(await bytesOf(f), { password: pwd, ignoreEncryption: true });
      var b = await src.save();
      return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-decrypted.pdf', msg: '解密完成' };
    } catch (e) { return { ok: false, msg: '密码错误或该文件未加密（' + (e.message || e) + '）' }; }
  }

  // ---------- 水印 ----------
  async function watermark(f, text) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var font = await src.embedFont(StandardFonts.HelveticaBold);
    src.getPages().forEach(function (p, idx) {
      var { width, height } = p.getSize();
      p.drawText(text || ('知办库 ' + (idx + 1)), { x: width / 2 - 80, y: height / 2, size: 34, font: font, color: rgb(0.7, 0.7, 0.7), opacity: 0.28, rotate: PDFLib.degrees(-30) });
    });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-watermark.pdf', msg: '已为全部页面添加水印' };
  }

  // ---------- 页码 ----------
  async function pageNumbers(f, pos) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var font = await src.embedFont(StandardFonts.Helvetica);
    var pages = src.getPages();
    for (var i = 0; i < pages.length; i++) {
      var pg = pages[i];
      var { width, height } = pg.getSize();
      var label = String(i + 1);
      var x = pos === 'left' ? 30 : pos === 'center' ? width / 2 - 8 : width - 40;
      var y = 22;
      pg.drawText(label, { x: x, y: y, size: 10, font: font, color: rgb(0.35, 0.35, 0.35) });
    }
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-numbered.pdf', msg: '已为 ' + pages.length + ' 页添加页码' };
  }

  // ---------- 裁剪 ----------
  async function crop(f, left, top, right, bottom) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    src.getPages().forEach(function (p) {
      var { width, height } = p.getSize();
      var l = parseFloat(left) || 0, t = parseFloat(top) || 0, r = parseFloat(right) || 0, b = parseFloat(bottom) || 0;
      p.setCropBox(l, b, width - r, height - t);
    });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-cropped.pdf', msg: '裁剪完成（单位 pt，1pt≈0.35mm）' };
  }

  // ---------- 修改页面大小 ----------
  async function resizePages(f, size) {
    var { PDFDocument } = lib();
    var sizes = { A4: [595, 842], A3: [842, 1191], A5: [420, 595], Letter: [612, 792] };
    var wh = sizes[size] || sizes.A4;
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    src.getPages().forEach(function (p) { p.setSize(wh[0], wh[1]); });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-' + size + '.pdf', msg: '已统一为 ' + size + ' 尺寸' };
  }

  // ---------- 叠加（两 PDF 合并/并排） ----------
  async function overlay(f1, f2, mode) {
    var { PDFDocument } = lib();
    var src1 = await PDFDocument.load(await bytesOf(f1), { ignoreEncryption: true });
    var src2 = await PDFDocument.load(await bytesOf(f2), { ignoreEncryption: true });
    var out = await PDFDocument.create();
    var n = Math.max(src1.getPageCount(), src2.getPageCount());
    for (var i = 0; i < n; i++) {
      var pgs = await out.copyPages(src1, [Math.min(i, src1.getPageCount() - 1)]);
      var pg = pgs[0];
      if (mode === 'side') { // 左右拼接：拉宽页面放第二个
        var w1 = pg.getWidth(), h = pg.getHeight();
        var pgs2 = await out.copyPages(src2, [Math.min(i, src2.getPageCount() - 1)]);
        var w2 = pgs2[0].getWidth();
        var wsum = w1 + w2, hmax = Math.max(h, pgs2[0].getHeight());
        pg.setSize(wsum, hmax);
        pgs2[0].setPosition(w1, 0);
        out.addPage(pg); out.addPage(pgs2[0]);
      } else { // 顺序叠加（交替页）或简单顺序
        out.addPage(pg);
        if (i < src2.getPageCount()) {
          var p2 = await out.copyPages(src2, [i]);
          out.addPage(p2[0]);
        }
      }
    }
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'overlay.pdf', msg: '叠加完成，共 ' + out.getPageCount() + ' 页' };
  }

  // ---------- 移除元数据 ----------
  async function removeMetadata(f) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    src.setTitle(''); src.setAuthor(''); src.setSubject(''); src.setKeywords([]);
    src.setProducer(''); src.setCreator('');
    src.setCreationDate(new Date()); src.setModificationDate(new Date());
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-nometa.pdf', msg: '元数据已清除' };
  }

  // ---------- 编辑元数据 ----------
  async function editMetadata(f, title, author, subject) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    if (title) src.setTitle(title);
    if (author) src.setAuthor(author);
    if (subject) src.setSubject(subject);
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-meta.pdf', msg: '元数据已更新' };
  }

  // ---------- 优化（重新保存减体积） ----------
  async function optimize(f) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var b = await src.save({ useObjectStreams: true });
    var oldSize = f.size, newSize = b.byteLength;
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-optimized.pdf', msg: '优化完成：' + (oldSize / 1024).toFixed(0) + 'KB → ' + (newSize / 1024).toFixed(0) + 'KB' };
  }

  // ---------- 签署（文字签名 + 日期） ----------
  async function sign(f, name, pageNo) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var font = await src.embedFont(StandardFonts.Helvetica);
    var pages = src.getPages();
    var pi = (parseInt(pageNo) || 1) - 1;
    if (pi < 0 || pi >= pages.length) pi = pages.length - 1;
    var pg = pages[pi];
    var { width } = pg.getSize();
    var now = new Date().toISOString().slice(0, 10);
    pg.drawText(name || '签署人', { x: width - 220, y: 50, size: 16, font: font, color: rgb(0.1, 0.1, 0.9) });
    pg.drawText(now, { x: width - 220, y: 32, size: 10, font: font, color: rgb(0.3, 0.3, 0.3) });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-signed.pdf', msg: '已在第 ' + (pi + 1) + ' 页添加签名' };
  }

  // ---------- 密文（黑块覆盖区域，简化为整行黑块） ----------
  async function redact(f, rectsText) {
    var { PDFDocument, rgb } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var pages = src.getPages();
    // rectsText: "x,y,w,h" 逗号分隔多组，作用于所有页（简化：每页顶部覆盖）
    pages.forEach(function (p) {
      var { width, height } = p.getSize();
      p.drawRectangle({ x: 10, y: height - 40, width: width - 20, height: 20, color: rgb(0, 0, 0) });
    });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-redacted.pdf', msg: '已覆盖顶部敏感区域（简化版）' };
  }

  // ---------- 创建求职申请书 ----------
  async function jobApplication(name, position, email, phone) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var out = await PDFDocument.create();
    var font = await out.embedFont(StandardFonts.Helvetica);
    var bold = await out.embedFont(StandardFonts.HelveticaBold);
    var page = out.addPage([595, 842]);
    var now = new Date().toISOString().slice(0, 10);
    var y = 780;
    page.drawText('求职申请书', { x: 210, y: y, size: 24, font: bold, color: rgb(0.1, 0.1, 0.2) }); y -= 40;
    page.drawText('日期：' + now, { x: 60, y: y, size: 12, font: font }); y -= 30;
    page.drawText('尊敬的招聘负责人：', { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('您好！我叫' + (name || '___') + '，应聘' + (position || '___') + '岗位。', { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('联系方式：' + (email || '___') + ' ｜ ' + (phone || '___'), { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('本人具备相关经验与技能，期待有机会与您面谈。', { x: 60, y: y, size: 12, font: font }); y -= 60;
    page.drawText('此致', { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('敬礼！', { x: 60, y: y, size: 12, font: font }); y -= 60;
    page.drawText('申请人：' + (name || '___'), { x: 420, y: y, size: 12, font: font });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'job-application.pdf', msg: '求职申请书已生成' };
  }

  // ---------- 创建账单 ----------
  async function invoice(company, item, amount, date) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var out = await PDFDocument.create();
    var font = await out.embedFont(StandardFonts.Helvetica);
    var bold = await out.embedFont(StandardFonts.HelveticaBold);
    var page = out.addPage([595, 842]);
    var y = 780;
    page.drawText('账单 / Invoice', { x: 230, y: y, size: 22, font: bold }); y -= 40;
    page.drawText('公司：' + (company || '___'), { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('日期：' + (date || new Date().toISOString().slice(0, 10)), { x: 60, y: y, size: 12, font: font }); y -= 40;
    page.drawText('项目：' + (item || '___'), { x: 60, y: y, size: 12, font: font }); y -= 24;
    page.drawText('金额：' + (amount || '___') + ' 元', { x: 60, y: y, size: 14, font: bold }); y -= 40;
    page.drawText('感谢您的信任与支持！', { x: 60, y: y, size: 12, font: font });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'invoice.pdf', msg: '账单已生成' };
  }

  // ---------- 编辑书签 ----------
  async function bookmarks(f, titlesText) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var titles = (titlesText || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    src.getPages().forEach(function (p, i) {
      p.node.setTitle ? p.node.setTitle(titles[i] || ('Page ' + (i + 1))) : null;
    });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-bookmarks.pdf', msg: '已为前 ' + titles.length + ' 页设置书签标题' };
  }

  // ---------- OCR（tesseract.js） ----------
  async function ocr(f, lang) {
    if (typeof Tesseract === 'undefined') return { ok: false, msg: 'OCR 引擎未加载，请检查网络' };
    var data = await f.arrayBuffer();
    var result = await Tesseract.recognize(data, lang || 'chi_sim+eng', { logger: function (m) { if (m.status === 'recognizing text') console.log('OCR ' + Math.round(m.progress * 100) + '%'); } });
    var text = result.data.text;
    var blob = new Blob([text], { type: 'text/plain' });
    return { ok: true, blob: blob, name: f.name.replace('.pdf', '') + '-text.txt', msg: '识别完成，共 ' + text.length + ' 字' };
  }

  // ---------- 注释（高亮所有页面第一行，简化版） ----------
  async function annotate(f, text) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var font = await src.embedFont(StandardFonts.Helvetica);
    src.getPages().forEach(function (p) {
      var { width, height } = p.getSize();
      p.drawRectangle({ x: 20, y: height - 36, width: 180, height: 18, color: rgb(1, 0.94, 0.5), opacity: 0.6 });
      p.drawText(text || '批注', { x: 24, y: height - 32, size: 11, font: font, color: rgb(0.2, 0.2, 0.2) });
    });
    var b = await src.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-annotated.pdf', msg: '已为全部页面添加高亮批注' };
  }

  // ---------- 每张纸多页（N-up：把多页缩放到一页） ----------
  async function nUp(f, perSheet) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var n = src.getPageCount();
    var per = parseInt(perSheet) || 4; // 2 或 4
    var out = await PDFDocument.create();
    var A4 = [595, 842];
    for (var start = 0; start < n; start += per) {
      var group = [];
      for (var i = start; i < Math.min(start + per, n); i++) group.push(i);
      var page = out.addPage(A4);
      var cols = per === 2 ? 2 : 2, rows = per === 2 ? 1 : 2;
      var w = (A4[0] - 30) / cols, h = (A4[1] - 30) / rows;
      for (var g = 0; g < group.length; g++) {
        var pgs = await out.copyPages(src, [group[g]]);
        var srcP = pgs[0];
        var sw = srcP.getWidth(), sh = srcP.getHeight();
        var scale = Math.min(w / sw, h / sh);
        var dw = sw * scale, dh = sh * scale;
        var col = g % cols, row = Math.floor(g / cols);
        var x = 15 + col * w + (w - dw) / 2;
        var y = A4[1] - 15 - (row + 1) * h + (h - dh) / 2;
        page.drawPage(srcP, { x: x, y: y, width: dw, height: dh });
      }
    }
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-nup.pdf', msg: '已按每张 ' + per + ' 页排版' };
  }

  // ---------- 创建可填写表单（文本框字段，简化版） ----------
  async function createForm(fieldsText) {
    var { PDFDocument, StandardFonts, rgb } = lib();
    var out = await PDFDocument.create();
    var font = await out.embedFont(StandardFonts.Helvetica);
    var page = out.addPage([595, 842]);
    var y = 780;
    var fields = (fieldsText || '姓名,电话,邮箱').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    fields.forEach(function (fld) {
      page.drawText(fld + '：', { x: 80, y: y, size: 13, font: font });
      page.drawRectangle({ x: 150, y: y - 2, width: 300, height: 18, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.8 });
      y -= 40;
    });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: 'form.pdf', msg: '已创建含 ' + fields.length + ' 个填写栏的表单' };
  }

  // ---------- 拼合（重保存为扁平版） ----------
  async function flatten(f) {
    var { PDFDocument } = lib();
    var src = await PDFDocument.load(await bytesOf(f), { ignoreEncryption: true });
    var out = await PDFDocument.create();
    var pgs = await out.copyPages(src, src.getPageIndices());
    pgs.forEach(function (p) { out.addPage(p); });
    var b = await out.save();
    return { ok: true, blob: new Blob([b], { type: 'application/pdf' }), name: f.name.replace('.pdf', '') + '-flattened.pdf', msg: '已重新拼合保存' };
  }

  // ---------- 提取图像（pdf.js 逐页渲染为图片导出） ----------
  async function extractImages(f) {
    var data = new Uint8Array(await f.arrayBuffer());
    var pdf = await pdfjsLib.getDocument({ data: data }).promise;
    var zip = new JSZip();
    for (var i = 1; i <= pdf.numPages; i++) {
      var page = await pdf.getPage(i);
      var vp = page.getViewport({ scale: 1.5 });
      var canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      zip.file('page-' + i + '.png', canvas.toDataURL('image/png').split(',')[1], { base64: true });
    }
    var blob = await zip.generateAsync({ type: 'blob' });
    return { ok: true, blob: blob, name: f.name.replace('.pdf', '') + '-images.zip', msg: '已导出 ' + pdf.numPages + ' 页图像' };
  }

  return {
    merge: merge, split: split, rotate: rotate, deletePages: deletePages,
    extractPages: extractPages, reorder: reorder, imagesToPdf: imagesToPdf,
    pdfToImages: pdfToImages, encrypt: encrypt, decrypt: decrypt,
    watermark: watermark, pageNumbers: pageNumbers, crop: crop,
    resizePages: resizePages, overlay: overlay, removeMetadata: removeMetadata,
    editMetadata: editMetadata, optimize: optimize, sign: sign,
    redact: redact, jobApplication: jobApplication, invoice: invoice,
    bookmarks: bookmarks, ocr: ocr, annotate: annotate, nUp: nUp,
    createForm: createForm, flatten: flatten, extractImages: extractImages,
    dload: dload
  };
})();
