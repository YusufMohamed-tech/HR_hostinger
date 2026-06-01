-- Tasks are employee assignments, not location assignments.
-- Keep the nullable column for backward compatibility but clear existing links.

UPDATE public.tasks
SET location_id = NULL
WHERE location_id IS NOT NULL;
