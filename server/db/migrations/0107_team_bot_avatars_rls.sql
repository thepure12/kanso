-- Bot profile pictures (0104) for team bots too: set_bot_avatar and
-- clear_bot_avatar check the caller through app.managed_bot_scope (0106),
-- so owners of a board bot's board or of a team bot's team manage its
-- picture (P0002 for unknown bots, 42501 for anyone else). Otherwise as 0104.

CREATE OR REPLACE FUNCTION app.set_bot_avatar(bot uuid, image_type text, image bytea, url text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.managed_bot_scope(bot);
  IF url IS NULL OR url !~ ('^(/[A-Za-z0-9._~-]+)*/api/users/' || bot::text || '/avatar\?v=[0-9a-f]{1,64}$') THEN
    RAISE EXCEPTION 'invalid avatar url' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_avatars (user_id, content_type, size, data, created_at)
  VALUES (bot, image_type, octet_length(image), image, now())
  ON CONFLICT (user_id) DO UPDATE
  SET content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data, created_at = EXCLUDED.created_at;
  UPDATE public.users SET avatar_url = url WHERE id = bot;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.clear_bot_avatar(bot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.managed_bot_scope(bot);
  DELETE FROM public.user_avatars WHERE user_id = bot;
  UPDATE public.users SET avatar_url = NULL WHERE id = bot;
END
$$;
