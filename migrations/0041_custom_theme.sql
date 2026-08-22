-- One custom colour profile per person, beside the five shipped palettes.
--
-- Three colours — main, accent, background — as JSON; every other token is
-- derived from them in the browser (customTokens() in core.js), so a
-- profile can't end up with outlines that don't match its cards. Go-green
-- and alert-red aren't in here on purpose: they mean the same thing in
-- every theme. NULL until someone builds one; theme_id = 'custom' selects it.
ALTER TABLE employees ADD COLUMN theme_colors TEXT;
