-- INSERT ... RETURNING checks cards_select on the new row, but
-- app.limited_card_ids() reads cards with the statement's snapshot and cannot
-- see that row, so limited members could not add cards through the API (or
-- app.copy_card) although cards_insert admitted them. A per-row fallback on
-- the card's own board, column and id (no read of cards) covers it. It runs
-- only for rows the two set checks reject: hidden cards of limited people and
-- rows inserted by the current statement.
ALTER POLICY cards_select ON cards
  USING (deleted_at IS NULL AND app.board_role(board_id) IS NOT NULL
    AND (board_id NOT IN (SELECT app.limited_board_ids()) OR id IN (SELECT app.limited_card_ids())
      OR app.my_access(board_id, column_id, id) <> 'none'));
