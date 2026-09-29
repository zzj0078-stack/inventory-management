/**
 * 直接调用打印机，不打开新窗口/新标签页。
 * 通过隐藏 iframe 承载打印内容，打印完成后自动移除。
 *
 * 注意：@page margin 设为 0 可让 Chrome/Edge 不绘制页眉页脚
 * （否则会打印出「日期 + 文档标题 + 页码」），页边距改由 body padding 提供。
 */
const PRINT_CSS = `
  @page { size: A4 portrait; margin: 0; }
  html, body {
    margin: 0; padding: 0;
    font-family: SimSun, '宋体', serif;
    font-size: 12px; color: #000;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body { padding: 12mm 10mm; box-sizing: border-box; }
  table { border-collapse: collapse; page-break-inside: avoid; }
  tr, td, th { page-break-inside: avoid; }
`

export function printHtml(html, { title = '' } = {}) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
    visibility: 'hidden'
  })
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow.document
  doc.open()
  // title 留空，避免打印页眉出现单据名
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${PRINT_CSS}</style></head><body>${html}</body></html>`
  )
  doc.close()

  const fire = () => {
    try {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } catch (e) {
      console.error('[PRINT] 调用打印机失败', e)
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }, 1500)
    }
  }

  setTimeout(fire, 300)
}
