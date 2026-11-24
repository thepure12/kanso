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
  /** In view order; only columns the person can still see. */
  columns: ViewColumn[]
}

/** Entry of GET /api/views. */
export interface CustomViewSummary {
  id: string
  name: string
  columnCount: number
}
