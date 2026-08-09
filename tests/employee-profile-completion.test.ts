import assert from "node:assert/strict";
import test from "node:test";
import { getMissingEmployeeFields, resolveEmployeeDisplayName } from "../src/lib/employee-profile-completion";
import { employeeCreateFormSchema } from "../src/lib/validation";

test("employee creation profile accepts no manually entered profile data", () => {
  const result = employeeCreateFormSchema.safeParse({});

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.employment_type, "full_time");
    assert.equal(result.data.status, "Active");
  }
});

test("account email becomes the temporary display name when names are missing", () => {
  assert.equal(resolveEmployeeDisplayName({}, " NEW.HIRE@Example.com "), "new.hire@example.com");
  assert.equal(resolveEmployeeDisplayName({ full_name_ar: "موظف جديد" }, "new@example.com"), "موظف جديد");
});

test("profile completion reports project and other empty employee data", () => {
  const missing = getMissingEmployeeFields({
    full_name_ar: "موظف جديد",
    full_name_en: "New Employee",
    phone: "0500000000",
    project_id: null,
  });

  assert.equal(missing.some((field) => field.key === "project_id" && field.label === "المشروع / القناة"), true);
  assert.equal(missing.some((field) => field.key === "phone"), false);
  assert.equal(missing.some((field) => field.key === "department_id"), true);
});

test("project completion accepts the legacy company assignment", () => {
  const missing = getMissingEmployeeFields({ company_id: "company-id" });
  assert.equal(missing.some((field) => field.key === "project_id"), false);
});
