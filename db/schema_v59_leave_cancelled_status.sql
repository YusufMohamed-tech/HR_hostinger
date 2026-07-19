-- PostgreSQL requires enum values to be committed before later migrations use them.
ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'cancelled';

