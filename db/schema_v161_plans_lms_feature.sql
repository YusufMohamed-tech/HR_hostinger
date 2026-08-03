-- Add lms feature flag to all plans so the middleware feature gate passes.
-- The LMS module (v43) enabled lms in organization_features but never updated
-- the plans table, causing planAllowsFeature('lms') to return false.

UPDATE public.plans
SET features = features || '{"lms": true}'::jsonb,
    updated_at = now()
WHERE NOT (features ? 'lms');
