-- Card button alignment: owners change it like the accent. boards_update
-- already admits only effective owners of unarchived boards, so a column
-- grant is enough. Everyone who can see the board sees it.
GRANT UPDATE (button_align) ON boards TO kanban_app;
