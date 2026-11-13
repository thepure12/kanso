/** What a paste offers: just the parts of `ClipboardEvent.clipboardData` this module reads. */
export interface PastedData {
  files: ArrayLike<File>
  types: readonly string[]
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `pasted-2026-11-13-154502.png`: browsers name every clipboard image `image.png`. */
export function pastedFileName(file: File, now: Date): string {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : `.${file.type.split('/')[1] ?? 'bin'}`
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `pasted-${stamp}${ext}`
}

/**
 * Files a paste should attach to the card, or none to leave the paste to the browser.
 * Into a text field, a paste that also carries plain text (a selection copied from Word or a
 * web page, which brings a picture of it along) stays text; a bare image is attached.
 * Clipboard images get a dated name; copied files keep theirs.
 */
export function pastedFiles(data: PastedData | null, intoTextField: boolean, now = new Date()): File[] {
  if (!data?.files.length) return []
  if (intoTextField && data.types.includes('text/plain')) return []
  return Array.from(data.files, f => f.name === 'image.png' || !f.name
    ? new File([f], pastedFileName(f, now), { type: f.type, lastModified: f.lastModified })
    : f)
}

/** Whether a paste lands in something that takes text. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'file', 'range', 'color'].includes(target.type))
}
