import { ImageViewerModal } from '#components'

export interface ViewerImage {
  /** URL of the image shown (full size). */
  src: string
  name?: string
  /** Download link; absent = `src` with a `download` attribute. */
  downloadUrl?: string
}

/**
 * Shows images in a dialog over the page (and over an open card), with
 * previous/next for several images.
 */
export function useImageViewer() {
  const overlay = useOverlay()
  // A fresh overlay per call, like useConfirm: destroyOnClose drops it from the list.
  return (images: ViewerImage[], index = 0) => {
    if (!images.length) return
    overlay.create(ImageViewerModal, { destroyOnClose: true }).open({ images, index: Math.min(Math.max(index, 0), images.length - 1) })
  }
}

/** Viewer entries for the images in rendered Markdown (not those inside a link). */
export function markdownImages(root: Element): { images: ViewerImage[], elements: HTMLImageElement[] } {
  const elements = [...root.querySelectorAll('img')].filter(img => !img.closest('a'))
  const images = elements.map((img) => {
    const src = img.getAttribute('src') ?? ''
    // Card attachments are served inline; `?download` forces the download.
    const attachment = /\/api\/attachments\/[^/?#]+$/.test(src)
    return { src, name: img.getAttribute('alt') || undefined, downloadUrl: attachment ? `${src}?download` : undefined }
  })
  return { images, elements }
}
