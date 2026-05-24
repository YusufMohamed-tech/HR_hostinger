import { z } from "zod";

const emptyToUndefined = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalTrimmedString = z.preprocess(emptyToUndefined, z.string().max(255).optional());
const optionalLongString = z.preprocess(emptyToUndefined, z.string().max(1000).optional());
const optionalDate = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").optional()
);
const optionalUuid = z.preprocess(emptyToUndefined, z.string().uuid("Select a valid record.").optional());
const optionalMoney = z.preprocess(
  emptyToUndefined,
  z.coerce.number().min(0, "Amount cannot be negative.").finite().optional()
);

export const employeeFormSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required.").max(160),
  employee_code: optionalTrimmedString,
  email: z.preprocess(emptyToUndefined, z.string().email("Use a valid email address.").optional()),
  phone: optionalTrimmedString,
  address: optionalLongString,
  emergency_contact_name: optionalTrimmedString,
  emergency_contact_phone: optionalTrimmedString,
  national_id: optionalTrimmedString,
  date_of_birth: optionalDate,
  gender: z.preprocess(emptyToUndefined, z.enum(["male", "female"]).optional()),
  hiring_date: optionalDate,
  department_id: optionalUuid,
  job_title: optionalTrimmedString,
  manager_id: optionalUuid,
  location_id: optionalUuid,
  employment_type: z.enum(["full_time", "part_time", "intern", "contract"]),
  status: z.enum(["Active", "Inactive", "On Leave"]),
  base_salary: optionalMoney,
  bonus: optionalMoney,
  deductions: optionalMoney,
  payment_method: optionalTrimmedString,
  bank_account: optionalTrimmedString,
});

export const leaveRequestFormSchema = z
  .object({
    leave_type: z.enum(["sick", "vacation", "emergency"]),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required."),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date is required."),
    reason: optionalLongString,
  })
  .refine((value) => new Date(value.end_date) >= new Date(value.start_date), {
    message: "End date cannot be before start date.",
    path: ["end_date"],
  });

export const taskFormSchema = z.object({
  title: z.string().trim().min(2, "Title is required.").max(160),
  description: optionalLongString,
  priority: z.enum(["low", "medium", "high"]),
  due_date: optionalDate,
  location_id: optionalUuid,
  employee_id: optionalUuid,
});

export const departmentFormSchema = z.object({
  name: z.string().trim().min(2, "Department name is required.").max(160),
  manager_employee_id: optionalUuid,
});

export const locationFormSchema = z.object({
  name: z.string().trim().min(2, "Location name is required.").max(160),
  type: z.enum(["branch", "booth", "office", "area"]),
  latitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-90).max(90).optional()),
  longitude: z.preprocess(emptyToUndefined, z.coerce.number().min(-180).max(180).optional()),
  radius_meters: z.preprocess(emptyToUndefined, z.coerce.number().min(10).max(10000).optional()),
  manager_employee_id: optionalUuid,
});

export function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
