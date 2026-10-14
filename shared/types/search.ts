/** A card matching the search, by title, description or one of its comments. */
export interface CardHit {
  id: string
  title: string
  /** Plain-text excerpt of the matching comment or the description; null when both are empty. */
  snippet: string | null
  /** True when only a comment matched. */
  inComment: boolean
  /** The card or its board is archived (only with archived=1). */
  archived: boolean
  boardId: string
  boardName: string
  columnId: string
  columnName: string
}

export interface BoardHit {
  id: string
  name: string
}

export interface ColumnHit {
  id: string
  title: string
  boardId: string
  boardName: string
}

export interface SearchResults {
  cards: CardHit[]
  boards: BoardHit[]
  columns: ColumnHit[]
}
