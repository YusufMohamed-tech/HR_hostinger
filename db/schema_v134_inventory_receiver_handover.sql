-- Let the dedicated inventory receiver issue serialized-product custody to an
-- active field agent. Other commerce actions remain manager-only.

DO $migration$
DECLARE
  function_definition text;
  handover_manager_check text :=
    'IF p_action = ''handover_issue'' THEN
    IF actor_role_value NOT IN (''admin'', ''sales_manager'', ''onground_agent_manager'') THEN';
  handover_receiver_check text :=
    'IF p_action = ''handover_issue'' THEN
    IF actor_role_value NOT IN (''admin'', ''sales_manager'', ''onground_agent_manager'', ''inventory_receiver'') THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.execute_product_commerce_command(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure
  )
  INTO function_definition;

  IF position(handover_receiver_check IN function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(handover_manager_check IN function_definition) = 0 THEN
    RAISE EXCEPTION
      'The product-commerce handover authorization block was not found; refusing an unsafe rewrite.';
  END IF;

  function_definition := replace(
    function_definition,
    handover_manager_check,
    handover_receiver_check
  );
  EXECUTE function_definition;

  SELECT pg_get_functiondef(
    'public.execute_product_commerce_command(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure
  )
  INTO function_definition;
  IF position(handover_receiver_check IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Inventory receiver handover authorization was not installed.';
  END IF;
END
$migration$;

-- Field-agent accounts are employee-owned identities too. The provisioning
-- command predates the role and must accept it before an agent can appear in
-- the receiver's handover selector.
DO $migration$
DECLARE
  function_definition text;
  role_list_without_field_agent text :=
    '''onground_agent_manager'', ''inventory_receiver'', ''promoter'',';
  role_list_with_field_agent text :=
    '''onground_agent_manager'', ''inventory_receiver'', ''field_agent'', ''promoter'',';
BEGIN
  SELECT pg_get_functiondef(
    'public.link_employee_identity(uuid,uuid,uuid,uuid,uuid,text,text,public.org_role)'::regprocedure
  )
  INTO function_definition;

  IF position(role_list_with_field_agent IN function_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(role_list_without_field_agent IN function_definition) = 0 THEN
    RAISE EXCEPTION
      'The employee identity role allowlist was not found; refusing an unsafe rewrite.';
  END IF;

  function_definition := replace(
    function_definition,
    role_list_without_field_agent,
    role_list_with_field_agent
  );
  EXECUTE function_definition;

  SELECT pg_get_functiondef(
    'public.link_employee_identity(uuid,uuid,uuid,uuid,uuid,text,text,public.org_role)'::regprocedure
  )
  INTO function_definition;
  IF position(role_list_with_field_agent IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Field-agent identity provisioning was not installed.';
  END IF;
END
$migration$;
