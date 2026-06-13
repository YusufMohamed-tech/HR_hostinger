-- Backfill legacy locations so employee allowed-location filtering works.
-- Additive/data-fix only: no deletes and no table rebuilds.

UPDATE public.locations
SET city = CASE
  WHEN name ILIKE '%الرياض%' THEN 'الرياض'
  WHEN name ILIKE '%جدة%' THEN 'جدة'
  WHEN name ILIKE '%مكة%' THEN 'مكة المكرمة'
  WHEN name ILIKE '%المدينة%' THEN 'المدينة المنورة'
  WHEN name ILIKE '%الدمام%' THEN 'الدمام'
  WHEN name ILIKE '%الخبر%' THEN 'الخبر'
  WHEN name ILIKE '%الظهران%' THEN 'الظهران'
  WHEN name ILIKE '%تبوك%' THEN 'تبوك'
  WHEN name ILIKE '%أبها%' OR name ILIKE '%ابها%' THEN 'أبها'
  WHEN name ILIKE '%نجران%' THEN 'نجران'
  WHEN name ILIKE '%حائل%' THEN 'حائل'
  WHEN name ILIKE '%بريدة%' THEN 'بريدة'
  WHEN name ILIKE '%عنيزة%' THEN 'عنيزة'
  WHEN name ILIKE '%القصيم%' THEN 'القصيم'
  WHEN name ILIKE '%الخرج%' THEN 'الخرج'
  WHEN name ILIKE '%المجمعه%' OR name ILIKE '%المجمعة%' THEN 'المجمعة'
  WHEN name ILIKE '%الجوف%' THEN 'الجوف'
  WHEN name ILIKE '%الباحة%' THEN 'الباحة'
  WHEN name ILIKE '%ينبع%' THEN 'ينبع'
  WHEN name ILIKE '%جازان%' THEN 'جازان'
  WHEN name ILIKE '%الطائف%' THEN 'الطائف'
  WHEN name ILIKE '%الأحساء%' OR name ILIKE '%الاحساء%' THEN 'الأحساء'
  WHEN name ILIKE '%الجبيل%' THEN 'الجبيل'
  WHEN name ILIKE '%املج%' OR name ILIKE '%أملج%' THEN 'أملج'
  WHEN name ILIKE '%رأس تنورة%' OR name ILIKE '%راس تنورة%' THEN 'رأس تنورة'
  WHEN name ILIKE '%سيهات%' THEN 'سيهات'
  WHEN name ILIKE '%القطيف%' THEN 'القطيف'
  ELSE city
END
WHERE city IS NULL OR btrim(city) = '';

WITH classified_projects AS (
  SELECT
    l.id AS location_id,
    company.id AS project_id,
    company.name AS project_name
  FROM public.locations l
  JOIN LATERAL (
    SELECT sc.id, sc.name
    FROM public.sales_companies sc
    WHERE sc.organization_id = l.org_id
      AND sc.is_active = true
      AND (
        ((l.name ILIKE '%ليبارا%' OR l.name ILIKE '%lebara%') AND (sc.code = 'LEBARA' OR sc.slug = 'lebara'))
        OR ((l.name ILIKE '%فيرجن%' OR l.name ILIKE '%virgin%') AND (sc.code = 'VIRGIN' OR sc.slug = 'virgin-mobile'))
        OR ((l.name ILIKE '%سلام%' OR l.name ILIKE '%salam%') AND (sc.code = 'SALAM' OR sc.slug = 'salam'))
        OR ((l.name ILIKE '%ريدبول%' OR l.name ILIKE '%ريد بول%' OR l.name ILIKE '%red bull%' OR l.name ILIKE '%redbull%') AND (sc.code = 'RBM' OR sc.slug = 'red-bull-mobile'))
        OR ((l.name ILIKE '%موبايلي%' OR l.name ILIKE '%mobily%') AND (sc.code = 'MOBILY' OR sc.slug = 'mobily'))
        OR ((l.name ILIKE '%زين%' OR l.name ILIKE '%zain%') AND (sc.code = 'ZAIN' OR sc.slug = 'zain'))
        OR ((l.name ILIKE '%stc%' OR l.name ILIKE '%اس تي سي%' OR l.name ILIKE '%إس تي سي%') AND (sc.code = 'STC' OR sc.slug = 'stc'))
      )
    ORDER BY sc.created_at ASC, sc.id ASC
    LIMIT 1
  ) company ON true
)
UPDATE public.locations l
SET
  project_id = COALESCE(l.project_id, classified_projects.project_id),
  project_name = COALESCE(NULLIF(btrim(l.project_name), ''), classified_projects.project_name)
FROM classified_projects
WHERE l.id = classified_projects.location_id
  AND (
    l.project_id IS NULL
    OR l.project_name IS NULL
    OR btrim(l.project_name) = ''
  );
