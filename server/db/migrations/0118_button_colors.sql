-- Button colours become 'accent' (the board accent) or a #rrggbb from the colour picker.
UPDATE "board_buttons" SET "color" = CASE "color"
  WHEN 'primary' THEN 'accent'
  WHEN 'success' THEN '#22c55e'
  WHEN 'info' THEN '#3b82f6'
  WHEN 'warning' THEN '#f97316'
  WHEN 'error' THEN '#ef4444'
  ELSE '#64748b'
END WHERE "color" <> 'accent' AND "color" !~ '^#[0-9a-f]{6}$';--> statement-breakpoint
ALTER TABLE "board_buttons" ALTER COLUMN "color" SET DEFAULT 'accent';--> statement-breakpoint
ALTER TABLE "board_buttons" ADD CONSTRAINT "board_buttons_color_shape" CHECK ("board_buttons"."color" = 'accent' or "board_buttons"."color" ~ '^#[0-9a-f]{6}$');