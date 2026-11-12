ALTER TABLE "boards" ADD COLUMN "column_outline" jsonb;--> statement-breakpoint
ALTER TABLE "columns" ADD COLUMN "outline" jsonb;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_column_outline_shape" CHECK ("boards"."column_outline" is null or (
    jsonb_typeof("boards"."column_outline") = 'object'
    and "boards"."column_outline" ?& array['color', 'width', 'glow']
    and "boards"."column_outline" - 'color' - 'width' - 'glow' = '{}'::jsonb
    and ("boards"."column_outline"->'color' = 'null'::jsonb or "boards"."column_outline"->>'color' in ('accent', 'column') or "boards"."column_outline"->>'color' ~ '^#[0-9a-f]{6}$')
    and "boards"."column_outline"->'width' in ('1', '2', '3', '4')
    and "boards"."column_outline"->'glow' in ('0', '1', '2', '3')));--> statement-breakpoint
ALTER TABLE "columns" ADD CONSTRAINT "columns_outline_shape" CHECK ("columns"."outline" is null or (
    jsonb_typeof("columns"."outline") = 'object'
    and "columns"."outline" ?& array['color', 'width', 'glow']
    and "columns"."outline" - 'color' - 'width' - 'glow' = '{}'::jsonb
    and ("columns"."outline"->'color' = 'null'::jsonb or "columns"."outline"->>'color' in ('accent', 'column') or "columns"."outline"->>'color' ~ '^#[0-9a-f]{6}$')
    and "columns"."outline"->'width' in ('1', '2', '3', '4')
    and "columns"."outline"->'glow' in ('0', '1', '2', '3')));