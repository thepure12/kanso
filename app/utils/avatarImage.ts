/** Edge length of stored profile pictures, in pixels (shown at most ~64 px, so 2x+ for sharp screens). */
export const AVATAR_SIZE = 256

export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Largest zoom of the crop dialog, relative to the image just covering the frame. */
export const AVATAR_MAX_ZOOM = 4

/** A square part of the source image, in source pixels. */
export interface SquareCrop { sx: number, sy: number, side: number }

/**
 * The crop dialog's view: the image's top-left corner (x, y) relative to a
 * square frame of `frame` px, shown at `zoom` times the scale at which its
 * shorter side just fills the frame.
 */
export interface CropView { x: number, y: number, zoom: number }

/** Pixels on screen per source pixel. */
export function cropScale(width: number, height: number, frame: number, zoom: number): number {
  return frame / Math.min(width, height) * zoom
}

/** Clamps the zoom to [1, AVATAR_MAX_ZOOM] and the offset so the image always covers the frame. */
export function clampView(view: CropView, width: number, height: number, frame: number): CropView {
  const zoom = Math.min(AVATAR_MAX_ZOOM, Math.max(1, view.zoom))
  const scale = cropScale(width, height, frame, zoom)
  const clamp = (v: number, size: number) => Math.min(0, Math.max(frame - size * scale, v))
  return { x: clamp(view.x, width), y: clamp(view.y, height), zoom }
}

/** The view that shows the centred square at the smallest zoom. */
export function centredView(width: number, height: number, frame: number): CropView {
  const scale = cropScale(width, height, frame, 1)
  return { x: (frame - width * scale) / 2, y: (frame - height * scale) / 2, zoom: 1 }
}

/**
 * Changes the zoom while keeping the image point under (px, py) (frame
 * coordinates, default the centre) in place.
 */
export function zoomView(view: CropView, zoom: number, width: number, height: number, frame: number, px = frame / 2, py = frame / 2): CropView {
  const ratio = cropScale(width, height, frame, Math.min(AVATAR_MAX_ZOOM, Math.max(1, zoom))) / cropScale(width, height, frame, view.zoom)
  return clampView({ x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio, zoom }, width, height, frame)
}

/** The source square that the frame shows. */
export function cropFromView(view: CropView, width: number, height: number, frame: number): SquareCrop {
  const scale = cropScale(width, height, frame, view.zoom)
  const side = Math.min(width, height, Math.round(frame / scale))
  const sx = Math.min(width - side, Math.max(0, Math.round(-view.x / scale)))
  const sy = Math.min(height - side, Math.max(0, Math.round(-view.y / scale)))
  return { sx, sy, side }
}

/**
 * Draws the `crop` square of an image scaled to at most AVATAR_SIZE, as WebP
 * where the browser can encode it (else PNG). Animated GIFs keep their first
 * frame. Browser only.
 */
export async function renderAvatar(image: CanvasImageSource, crop: SquareCrop): Promise<Blob> {
  const size = Math.min(AVATAR_SIZE, crop.side)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, crop.sx, crop.sy, crop.side, crop.side, 0, 0, size, size)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode the image')), 'image/webp', 0.9))
}
