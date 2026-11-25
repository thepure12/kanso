-- Look of custom views (0143): background, accent and default column outline
-- on custom_views, plus the uploaded background image in custom_view_backgrounds.
-- Personal like the views themselves: custom_views_own already limits rows to
-- their user, so column grants are enough there; the image rows follow their view.
-- No notify triggers: nothing on a board changes.
GRANT UPDATE (background, accent, column_outline) ON custom_views TO kanban_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (content_type, size, data, created_at), DELETE ON custom_view_backgrounds TO kanban_app;
--> statement-breakpoint
ALTER TABLE custom_view_backgrounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY custom_view_backgrounds_own ON custom_view_backgrounds FOR ALL TO kanban_app
  USING (view_id IN (SELECT v.id FROM custom_views v))
  WITH CHECK (view_id IN (SELECT v.id FROM custom_views v));
--> statement-breakpoint

-- An 'upload' background needs its image (KB009 otherwise). SECURITY INVOKER:
-- only the view's user gets this far, and they can read the image row.
CREATE FUNCTION app.check_custom_view_background() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.background->>'kind' = 'upload'
     AND NOT EXISTS (SELECT 1 FROM public.custom_view_backgrounds WHERE view_id = NEW.id) THEN
    RAISE EXCEPTION 'upload a background image first' USING ERRCODE = 'KB009';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.check_custom_view_background() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER custom_views_check_background BEFORE INSERT OR UPDATE OF background ON custom_views
FOR EACH ROW EXECUTE FUNCTION app.check_custom_view_background();
--> statement-breakpoint

-- The uploaded image goes once the view uses another background.
CREATE FUNCTION app.drop_custom_view_background_image() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.custom_view_backgrounds WHERE view_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.drop_custom_view_background_image() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER custom_views_drop_background_image AFTER UPDATE OF background ON custom_views
FOR EACH ROW
WHEN (OLD.background->>'kind' = 'upload' AND NEW.background->>'kind' IS DISTINCT FROM 'upload')
EXECUTE FUNCTION app.drop_custom_view_background_image();
