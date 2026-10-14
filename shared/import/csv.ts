/**
 * RFC 4180 CSV parser: quoted fields may hold commas, doubled quotes and line
 * breaks; CRLF, LF and CR all end a row; a leading BOM is dropped. The
 * delimiter is ',' unless the header line has more ';' or tabs (Excel in some
 * locales). Blank lines are skipped. Returns rows of raw cell strings.
 */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
    cell = ''
  }
  while (i < text.length) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      }
      else cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    }
    else if (ch === '\r' || ch === '\n') {
      endRow()
      if (ch === '\r' && text[i + 1] === '\n') i++
    }
    else cell += ch
    i++
  }
  if (cell !== '' || row.length) endRow()
  return rows
}

function detectDelimiter(text: string): string {
  const header = text.slice(0, text.search(/\r|\n|$/))
  const count = (d: string) => header.split(d).length - 1
  return [';', '\t'].find(d => count(d) > count(',')) ?? ','
}
