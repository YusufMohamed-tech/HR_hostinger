-- Allow operational managers to create and update locations for their organization.
-- Additive policy update, no data deletion.

DROP POLICY IF EXISTS org_insert_locations ON public.locations;
DROP POLICY IF EXISTS org_update_locations ON public.locations;

CREATE POLICY org_insert_locations ON public.locations
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR public.current_role() IN ('training_manager', 'sales_manager')
      OR auth.role() = 'service_role'
    )
  );

CREATE POLICY org_update_locations ON public.locations
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR public.current_role() IN ('training_manager', 'sales_manager')
      OR auth.role() = 'service_role'
    )
  )
  WITH CHECK (
    org_id = public.current_org_id()
    AND (
      public.is_admin()
      OR public.current_role() IN ('training_manager', 'sales_manager')
      OR auth.role() = 'service_role'
    )
  );
