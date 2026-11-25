-- Agent rules: settle_seconds (0145), how long the card must stay unchanged
-- before the runner starts. Editors set it like the rest of the rule.
GRANT UPDATE (settle_seconds) ON board_agent_rules TO kanban_app;
