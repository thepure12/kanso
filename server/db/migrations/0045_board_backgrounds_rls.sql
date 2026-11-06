-- Board backgrounds: boards.background (colour, gradient, stock photo or
-- uploaded image) and board_backgrounds (the uploaded image, one per board).
--
-- Owners change them, like the board name: boards_update already admits only
-- effective owners of unarchived boards, so a column grant is enough there.
-- Everyone who can see the board sees its background.

GRANT UPDATE (background) ON boards TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (content_type, size, data, created_at), DELETE ON board_backgrounds TO kanban_app;
--> statement-breakpoint

ALTER TABLE board_backgrounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY board_backgrounds_select ON board_backgrounds FOR SELECT TO kanban_app
  USING (app.board_role(board_id) IS NOT NULL);
--> statement-breakpoint
CREATE POLICY board_backgrounds_insert ON board_backgrounds FOR INSERT TO kanban_app
  WITH CHECK (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id));
--> statement-breakpoint
CREATE POLICY board_backgrounds_update ON board_backgrounds FOR UPDATE TO kanban_app
  USING (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id))
  WITH CHECK (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id));
--> statement-breakpoint
CREATE POLICY board_backgrounds_delete ON board_backgrounds FOR DELETE TO kanban_app
  USING (app.board_role(board_id) = 'owner' AND NOT app.board_archived(board_id));
--> statement-breakpoint

-- An 'upload' background needs its image (KB009 otherwise). SECURITY INVOKER:
-- only owners get this far (boards_update), and they can read the image row.
CREATE FUNCTION app.check_board_background() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.background->>'kind' = 'upload'
     AND NOT EXISTS (SELECT 1 FROM public.board_backgrounds WHERE board_id = NEW.id) THEN
    RAISE EXCEPTION 'upload a background image first' USING ERRCODE = 'KB009';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.check_board_background() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER boards_check_background BEFORE UPDATE OF background ON boards
FOR EACH ROW EXECUTE FUNCTION app.check_board_background();
--> statement-breakpoint

-- The uploaded image goes once the board uses another background.
CREATE FUNCTION app.drop_board_background_image() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.board_backgrounds WHERE board_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.drop_board_background_image() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER boards_drop_background_image AFTER UPDATE OF background ON boards
FOR EACH ROW
WHEN (OLD.background->>'kind' = 'upload' AND NEW.background->>'kind' IS DISTINCT FROM 'upload')
EXECUTE FUNCTION app.drop_board_background_image();
