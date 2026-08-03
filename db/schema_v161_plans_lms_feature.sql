-- Ensure the LMS feature gate passes on all three middleware checks:
-- 1. plans.features must contain "lms": true
-- 2. organization_features.lms_enabled must be true
-- 3. organization_features.enabled_modules must contain "lms"

-- Fix 1: plans table
UPDATE public.plans
SET features = features || '{"lms": true}'::jsonb,
    updated_at = now()
WHERE NOT (features ? 'lms');

-- Fix 2: lms_enabled column (should already exist from v43, but ensure value is true)
UPDATE public.organization_features
SET lms_enabled = true,
    updated_at = now()
WHERE lms_enabled IS DISTINCT FROM true;

-- Fix 3: enabled_modules array must include "lms"
UPDATE public.organization_features
SET enabled_modules = CASE
    WHEN enabled_modules ? 'lms' THEN enabled_modules
    ELSE enabled_modules || '["lms"]'::jsonb
  END,
  updated_at = now()
WHERE NOT (enabled_modules ? 'lms');
