-- Migration v138: Add supervisor role to org_role enum
-- Must be in its own transaction before the enum value can be referenced.

ALTER TYPE public.org_role ADD VALUE IF NOT EXISTS 'supervisor';
