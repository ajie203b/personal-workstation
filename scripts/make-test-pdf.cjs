// 生成测试用 PDF（3 页，含标题和正文，供 M2 阅读器实测）
const fs = require('fs')

function esc(s) {
  return s.replace(/([\\()])/g, '\\$1')
}

const pages = []
for (let p = 1; p <= 3; p++) {
  const lines = [
    `Chapter ${p} - Reading Test Document`,
    '',
    `This is page ${p} of the sample PDF used to verify the`,
    'document workstation reader: lazy window rendering,',
    'text-layer selection highlight, position memory and',
    'the outline table of contents.',
    '',
    p === 1
      ? 'Scroll down to test position restore.'
      : p === 2
        ? 'Select a line with your mouse to create a highlight.'
        : 'You reached the last page. Progress should read 100%.',
  ]
  let content = 'BT\n/F1 16 Tf\n72 720 Td\n'
  lines.forEach((line, i) => {
    if (i === 0) content += `(${esc(line)}) Tj\n/F1 12 Tf\n`
    else content += `0 -22 Td (${esc(line)}) Tj\n`
  })
  content += 'ET'
  pages.push(content)
}

const objects = []
// 1 catalog, 2 pages, per page: page obj + content obj, font
objects.push('<< /Type /Catalog /Pages 2 0 R >>')
const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
pages.forEach((content, i) => {
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + pages.length * 2} 0 R >> >> >>`)
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
})
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

let pdf = '%PDF-1.4\n'
const offsets = [0]
objects.forEach((body, i) => {
  offsets.push(pdf.length)
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xrefStart = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (let i = 1; i <= objects.length; i++) {
  pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

fs.writeFileSync(process.argv[2] || 'sample.pdf', pdf, 'binary')
console.log('PDF generated:', process.argv[2], pdf.length, 'bytes')
