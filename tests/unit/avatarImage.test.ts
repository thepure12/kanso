import { describe, expect, it } from 'vitest'
import { centredView, clampView, cropFromView, zoomView } from '../../app/utils/avatarImage'

// A 400 × 300 image in a 300 px frame: scale 1 at zoom 1.
describe('avatar crop', () => {
  it('starts on the centred square', () => {
    const view = centredView(400, 300, 300)
    expect(view).toEqual({ x: -50, y: 0, zoom: 1 })
    expect(cropFromView(view, 400, 300, 300)).toEqual({ sx: 50, sy: 0, side: 300 })
  })

  it('keeps the image covering the frame', () => {
    expect(clampView({ x: 20, y: 30, zoom: 1 }, 400, 300, 300)).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(clampView({ x: -500, y: -500, zoom: 1 }, 400, 300, 300)).toEqual({ x: -100, y: 0, zoom: 1 })
    expect(clampView({ x: 0, y: 0, zoom: 9 }, 400, 300, 300).zoom).toBe(4)
    expect(clampView({ x: 0, y: 0, zoom: 0.5 }, 400, 300, 300).zoom).toBe(1)
  })

  it('zooms around a point and crops the part shown', () => {
    // Zoom 2 around the centre of the centred view: the middle 150 px square.
    const view = zoomView(centredView(400, 300, 300), 2, 400, 300, 300)
    expect(view).toEqual({ x: -250, y: -150, zoom: 2 })
    expect(cropFromView(view, 400, 300, 300)).toEqual({ sx: 125, sy: 75, side: 150 })
    // Zoom around the top-left corner keeps that corner.
    expect(zoomView({ x: 0, y: 0, zoom: 1 }, 2, 400, 300, 300, 0, 0)).toEqual({ x: 0, y: 0, zoom: 2 })
  })

  it('scales small and tall images', () => {
    expect(cropFromView(centredView(64, 64, 300), 64, 64, 300)).toEqual({ sx: 0, sy: 0, side: 64 })
    expect(cropFromView(centredView(300, 501, 300), 300, 501, 300)).toEqual({ sx: 0, sy: 101, side: 300 })
  })
})
