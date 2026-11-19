export function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['First text','Second text'].map(text => {
      const content = 'BT /F1 18 Tf 20 130 Td (' + text + ') Tj ET\n'
      return '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream'
    }),
  ]
  let pdf='%PDF-1.4\n'
  const offsets = [0]
  for (const [index,body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += (index+1)+' 0 obj\n'+body+'\nendobj\n'
  }
  const xref=pdf.length
  pdf += 'xref\n0 '+offsets.length+'\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10,'0')+' 00000 n \n'
  return Buffer.from(pdf+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n')
}
