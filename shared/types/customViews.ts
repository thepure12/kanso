import type { BoardAccent } from '../boardAccents'
import type { BoardBackground } from '../boardBackgrounds'
import type { ColumnOutline } from '../columnOutline'

/** A column offered for (or shown in) a custom view, with its board. */
export interface ViewColumn {
  columnId: string
  boardId: string
  boardName: string
  title: string
  /** Heading colour (#rrggbb) or null. */
  color: string | null
}

/** A person's own named set of columns from several boards (GET /api/views/:id). */
export interface CustomView {
  id: string
  name: string
  /** Starred by its user: listed with the starred boards on the home page. */
  starred: boolean
  /** In view order; only columns the person can still see. */
  columns: ViewColumn[]
  /** The view's own look, as on a board (null = plain / app default / each board's outline). */
  background: BoardBackground | null
  accent: BoardAccent | null
  /** Default frame of the view's columns; a column's own outline still wins. */
  columnOutline: ColumnOutline | null
}

/** Entry of GET /api/views. */
export interface CustomViewSummary {
  id: string
  name: string
  starred: boolean
  columnCount: number
  /** For the home page tile, as on board tiles. */
  background: BoardBackground | null
  accent: BoardAccent | null
}
