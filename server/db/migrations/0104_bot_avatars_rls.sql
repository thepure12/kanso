-- Bot profile pictures: owners of a bot's board set or remove its picture.
-- user_avatars policies only let people change their own row and bots never
-- sign in, so these SECURITY DEFINER functions do it after app.owned_bot_board
-- (P0002 for unknown bots, 42501 for anyone but effective owners). The app
-- checks and scales the image like for /api/account/avatar; the table checks
-- (user_avatars_type, user_avatars_size) still apply. avatar_url must point at
-- the bot's own GET /api/users/:id/avatar (any base path), else 22023.

CREATE FUNCTION app.set_bot_avatar(bot uuid, image_type text, image bytea, url text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_bot_board(bot);
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

CREATE FUNCTION app.clear_bot_avatar(bot uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM app.owned_bot_board(bot);
  DELETE FROM public.user_avatars WHERE user_id = bot;
  UPDATE public.users SET avatar_url = NULL WHERE id = bot;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION app.set_bot_avatar(uuid, text, bytea, text), app.clear_bot_avatar(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.set_bot_avatar(uuid, text, bytea, text), app.clear_bot_avatar(uuid) TO kanban_app;
