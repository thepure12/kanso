-- Board accent colour: owners change it like the name and background.
-- boards_update already admits only effective owners of unarchived boards,
-- so a column grant is enough. Everyone who can see the board sees it.
GRANT UPDATE (accent) ON boards TO kanban_app;
