"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Pencil } from "lucide-react";
import { useDepartments, useLocations, useEmployees } from "@/hooks/use-data";
import { updateEmployee } from "@/lib/services/employees";

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employee: any;
  onSuccess: () => void;
}

export function EditEmployeeDialog({ employee, onSuccess }: Props) {
  const { data: departments } = useDepartments();
  const { data: locations } = useLocations();
  const { data: employees } = useEmployees();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    employee_code: "",
    email: "",
    phone: "",
    address: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    national_id: "",
    date_of_birth: "",
    gender: "",
    hiring_date: "",
    department_id: "",
    job_title: "",
    manager_id: "",
    location_id: "",
    employment_type: "full_time",
    status: "Active",
    base_salary: "",
    bonus: "",
    deductions: "",
    payment_method: "",
    bank_account: "",
  });

  useEffect(() => {
    if (employee && open) {
      setForm({
        full_name: employee.full_name || employee.name || "",
        employee_code: employee.employee_code || "",
        email: employee.email || "",
        phone: employee.phone || "",
        address: employee.address || "",
        emergency_contact_name: employee.emergency_contact_name || "",
        emergency_contact_phone: employee.emergency_contact_phone || "",
        national_id: employee.national_id || "",
        date_of_birth: employee.date_of_birth || "",
        gender: employee.gender || "",
        hiring_date: employee.hiring_date || "",
        department_id: employee.department_id || "",
        job_title: employee.job_title || "",
        manager_id: employee.manager_id || "",
        location_id: employee.location_id || "",
        employment_type: employee.employment_type || "full_time",
        status: employee.status || "Active",
        base_salary: employee.base_salary ? String(employee.base_salary) : "",
        bonus: employee.bonus ? String(employee.bonus) : "",
        deductions: employee.deductions ? String(employee.deductions) : "",
        payment_method: employee.payment_method || "",
        bank_account: employee.bank_account || "",
      });
    }
  }, [employee, open]);

  const set = (key: string, value: string | null) => setForm((prev) => ({ ...prev, [key]: value ?? "" }));

  const handleSubmit = async () => {
    if (!form.full_name) return;
    setSubmitting(true);
    setError("");

    const payload = {
      full_name: form.full_name,
      employee_code: form.employee_code || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      emergency_contact_name: form.emergency_contact_name || undefined,
      emergency_contact_phone: form.emergency_contact_phone || undefined,
      national_id: form.national_id || undefined,
      date_of_birth: form.date_of_birth || undefined,
      gender: form.gender || undefined,
      hiring_date: form.hiring_date || undefined,
      department_id: form.department_id || undefined,
      job_title: form.job_title || undefined,
      manager_id: form.manager_id || undefined,
      location_id: form.location_id || undefined,
      employment_type: form.employment_type || undefined,
      status: form.status || undefined,
      base_salary: form.base_salary ? parseFloat(form.base_salary) : undefined,
      bonus: form.bonus ? parseFloat(form.bonus) : undefined,
      deductions: form.deductions ? parseFloat(form.deductions) : undefined,
      payment_method: form.payment_method || undefined,
      bank_account: form.bank_account || undefined,
    };

    const { error: err } = await updateEmployee(employee.id, payload);

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setOpen(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-brand hover:text-brand-dark" />}>
        <Pencil className="w-3.5 h-3.5 mr-1" />
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
          <DialogDescription>Update employee details and role settings.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">Basic Info</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Employee ID</Label>
                <Input value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={form.email} onChange={(e) => set("email", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>National ID</Label>
                <Input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Date of Birth</Label>
                <Input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Hiring Date</Label>
                <Input type="date" value={form.hiring_date} onChange={(e) => set("hiring_date", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Emergency Contact Name</Label>
                <Input value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Emergency Contact Phone</Label>
                <Input value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">Work Info</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => set("department_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>{String(d.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Job Title</Label>
                <Input value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Manager</Label>
                <Select value={form.manager_id} onValueChange={(v) => set("manager_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={String(emp.id)}>{String(emp.full_name || emp.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={form.location_id} onValueChange={(v) => set("location_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{String(l.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Employment Type</Label>
                <Select value={form.employment_type} onValueChange={(v) => set("employment_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">Full-time</SelectItem>
                    <SelectItem value="part_time">Part-time</SelectItem>
                    <SelectItem value="intern">Intern</SelectItem>
                    <SelectItem value="contract">Contract</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="On Leave">On Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Input value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-700">Salary Info</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Base Salary</Label>
                <Input type="number" value={form.base_salary} onChange={(e) => set("base_salary", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bonus</Label>
                <Input type="number" value={form.bonus} onChange={(e) => set("bonus", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Deductions</Label>
                <Input type="number" value={form.deductions} onChange={(e) => set("deductions", e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bank Account</Label>
                <Input value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSubmit} disabled={submitting || !form.full_name}>
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
