const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let browser;
after(async () => { if (browser) await browser.close(); });

test('sticker text fits in preview and print without changing the saved layout', async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const font = fs.readFileSync(path.join(root, 'assets', 'fonts', 'Sarabun-Bold.ttf')).toString('base64');
  await page.setContent(`<style>
    @font-face { font-family: Sarabun; src: url(data:font/ttf;base64,${font}); font-weight: 700 }
    * { transition: all .2s }
  </style>`);
  await page.addScriptTag({ path: path.join(root, 'asset-tools.js') });
  const result = await page.evaluate(async () => {
    await document.fonts.load('700 9px Sarabun');
    const longText = 'ครุภัณฑ์วิทยาศาสตร์และการแพทย์';
    const run = (doc, scale, value, selected = false) => {
      const box = doc.createElement('div');
      box.className = 'sticker-text';
      box.style.cssText = `width:${24 * scale}px;height:${3.4 * scale}px;display:flex;align-items:center;font:700 ${6.6 * scale * 25.4 / 72}px/1.35 Sarabun,sans-serif;white-space:pre-wrap;word-break:break-word;overflow:hidden`;
      const text = doc.createElement('span');
      text.className = 'sticker-fit-text';
      text.textContent = value;
      box.appendChild(text);
      if (selected) {
        const handle = doc.createElement('div');
        handle.className = 'sticker-resize-handle';
        handle.style.cssText = 'position:absolute;width:10px;height:10px';
        box.appendChild(handle);
      }
      doc.body.appendChild(box);
      const initialSize = parseFloat(doc.defaultView.getComputedStyle(box).fontSize);
      const unfit = window.fitStickerText(box.parentNode, '.sticker-text', 4 * scale * 25.4 / 72);
      const content = text.getBoundingClientRect();
      const bounds = box.getBoundingClientRect();
      const output = {
        unfit,
        initialSize,
        finalSize: parseFloat(doc.defaultView.getComputedStyle(box).fontSize),
        contentHeight: content.height,
        boxHeight: bounds.height,
        contentWidth: content.width,
        boxWidth: bounds.width,
        text: text.textContent,
        handlePreserved: !selected || Boolean(box.querySelector('.sticker-resize-handle')),
      };
      box.remove();
      return output;
    };
    const preview = run(document, 7.5, longText, true);
    const short = run(document, 7.5, 'ทั่วไป');
    const unfit = run(document, 7.5, longText.repeat(30));
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frame.contentDocument.head.innerHTML = document.head.innerHTML;
    await frame.contentDocument.fonts.load('700 9px Sarabun');
    const print = run(frame.contentDocument, 96 / 25.4, longText);
    frame.remove();
    return { preview, short, unfit, print, longText };
  });
  for (const item of [result.preview, result.print]) {
    assert.equal(item.unfit, 0);
    assert.ok(item.finalSize < item.initialSize);
    assert.ok(item.contentHeight <= item.boxHeight + 0.1);
    assert.ok(item.contentWidth <= item.boxWidth + 0.1);
    assert.equal(item.text, result.longText);
    assert.ok(item.handlePreserved);
  }
  assert.equal(result.short.unfit, 0);
  assert.equal(result.short.finalSize, result.short.initialSize);
  assert.equal(result.unfit.unfit, 1);
  assert.equal(result.unfit.text, result.longText.repeat(30));
  await page.close();
});
