-- The booth's sections, renamed.
--
-- ENTRANCE -> SOUTH, so the four sides read as compass points the way the
-- shelf codes already do (S1 and S2 stand on the south side). CENTRE ->
-- CENTER to match the rest of the portal's spelling.
--
-- The section is stored on the row rather than referenced by id, so existing
-- plans have to be rewritten or they'd group under a heading that is no
-- longer one of the choices.

UPDATE shelf_positions SET wall = 'SOUTH' WHERE wall = 'ENTRANCE';
UPDATE shelf_positions SET wall = 'CENTER' WHERE wall = 'CENTRE';
