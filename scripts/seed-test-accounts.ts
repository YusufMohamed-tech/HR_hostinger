import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email: string) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (orgError || !organization) throw new Error(orgError?.message || "No organization found.");

  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id, name")
    .eq("org_id", organization.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (departmentError || !department) throw new Error(departmentError?.message || "No department found.");

  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("id, name")
    .eq("org_id", organization.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (locationError || !location) throw new Error(locationError?.message || "No location found.");

  const rows: Array<Record<string, string>> = [];

  for (let index = 1; index <= 10; index += 1) {
    const email = `employee${index}@tatwir.sa`;
    const password = "Employee@1234";
    const fullName = `Test Employee ${index}`;
    const existing = await findUserByEmail(email);
    const authResult = existing
      ? await supabase.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        })
      : await supabase.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

    if (authResult.error || !authResult.data.user) throw authResult.error || new Error(`Unable to create ${email}`);
    const userId = authResult.data.user.id;

    await supabase.from("profiles").upsert({
      user_id: userId,
      org_id: organization.id,
      full_name: fullName,
      email,
      account_status: "active",
      title: "Test Employee",
    }, { onConflict: "user_id" });

    await supabase.from("org_members").upsert({
      org_id: organization.id,
      user_id: userId,
      role: "employee",
    }, { onConflict: "org_id,user_id" });

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .upsert({
        org_id: organization.id,
        user_id: userId,
        full_name: fullName,
        employee_code: `TEST-EMP-${String(index).padStart(3, "0")}`,
        email,
        department_id: department.id,
        location_id: location.id,
        job_title: "Test Account",
        status: "Active",
        employment_type: "full_time",
        is_test_account: true,
        hiring_date: new Date().toISOString().split("T")[0],
      }, { onConflict: "org_id,employee_code" })
      .select("id")
      .single();

    if (employeeError || !employee) throw employeeError || new Error(`Unable to create employee row for ${email}`);

    await supabase.from("employee_locations").upsert({
      employee_id: employee.id,
      location_id: location.id,
      is_primary: true,
      assigned_from: new Date().toISOString().split("T")[0],
    }, { onConflict: "employee_id,location_id" });

    rows.push({
      email,
      password,
      role: "Employee",
      organization: String(organization.name),
      department: String(department.name),
      location: String(location.name),
    });
  }

  console.table(rows);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
