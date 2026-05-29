"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, Plus, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/Skeletons";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createSuperadminOrganization,
  getSuperadminOrganizations,
  type SuperadminOrganization,
  updateSuperadminOrganization,
} from "@/lib/services/superadmin-organizations";

const isActiveStatus = (status: string) => status.trim().toLowerCase() === "active";

const defaultForm = {
  name: "",
  slug: "",
  status: "Active",
};

export default function SuperadminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<SuperadminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrganizations = async () => {
    setLoading(true);
    const result = await getSuperadminOrganizations();
    if (result.error) {
      setError(result.error.message);
      setOrganizations([]);
    } else {
      setError(null);
      setOrganizations(result.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOrganizations();
  }, []);

  const totals = useMemo(() => {
    return organizations.reduce(
      (summary, organization) => ({
        organizations: summary.organizations + 1,
        members: summary.members + organization.memberCount,
        employees: summary.employees + organization.employeeCount,
      }),
      { organizations: 0, members: 0, employees: 0 }
    );
  }, [organizations]);

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">إدارة المنظمات</h1>
          <p className="mt-1 text-sm text-gray-500">
            إدارة الجهات من منظور مركزي، مع فصل واضح بين بيانات المنصة وسطح تشغيل الموارد البشرية داخل كل جهة.
          </p>
        </div>
        <CreateOrganizationDialog onSuccess={loadOrganizations} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">إجمالي المنظمات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-950">{totals.organizations}</div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">إجمالي الأعضاء</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-950">{totals.members}</div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-600">إجمالي الموظفين</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-950">{totals.employees}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>سجل المنظمات</CardTitle>
          <CardDescription>عرض الجهات الحالية، حالتها، وعدد أعضاء HR والإدارة داخل كل جهة.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">المنظمة</TableHead>
                <TableHead className="font-semibold text-gray-600">الحالة</TableHead>
                <TableHead className="font-semibold text-gray-600">الأعضاء</TableHead>
                <TableHead className="font-semibold text-gray-600">فريق HR</TableHead>
                <TableHead className="font-semibold text-gray-600">الموظفون</TableHead>
                <TableHead className="font-semibold text-gray-600">تاريخ الإنشاء</TableHead>
                <TableHead className="text-right font-semibold text-gray-600">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-950">{organization.name}</span>
                      <span className="text-xs text-slate-500">{organization.slug || "بدون slug"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={isActiveStatus(organization.status)
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"}
                    >
                      {organization.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{organization.memberCount}</TableCell>
                  <TableCell className="text-slate-600">
                    {organization.hrAdminCount + organization.hrRecruitmentCount}
                  </TableCell>
                  <TableCell className="text-slate-600">{organization.employeeCount}</TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(organization.created_at).toLocaleDateString("en-CA")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/superadmin/organizations/${organization.id}`}>فتح</Link>
                      </Button>
                      <EditOrganizationDialog organization={organization} onSuccess={loadOrganizations} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {organizations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm font-medium text-gray-900">لا توجد منظمات بعد</p>
              <p className="mt-1 text-xs text-gray-500">أنشئ أول منظمة لبدء إدارة المنصة.</p>
            </div>
          )}

          {error && (
            <div className="border-t px-4 py-3 text-sm text-red-600">{error}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateOrganizationDialog({ onSuccess }: { onSuccess: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof defaultForm, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("اسم المنظمة مطلوب.");
      return;
    }

    setSubmitting(true);
    setError("");
    const result = await createSuperadminOrganization(form);
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSaved(true);
    await onSuccess();
    setTimeout(() => {
      setSaved(false);
      setOpen(false);
      setForm(defaultForm);
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand text-white hover:bg-brand-dark" />}>
        <Plus className="ml-2 h-4 w-4" />
        منظمة جديدة
      </DialogTrigger>
      <DialogContent className="sm:max-w-[430px]">
        <DialogHeader>
          <DialogTitle>إنشاء منظمة</DialogTitle>
          <DialogDescription>إضافة جهة جديدة إلى المنصة مع slug وحالة تشغيل أولية.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>اسم المنظمة</Label>
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Tatwir Holding" />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={form.slug} onChange={(event) => set("slug", event.target.value)} placeholder="tatwir-holding" />
          </div>
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Input value={form.status} onChange={(event) => set("status", event.target.value)} placeholder="Active" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleSubmit} disabled={submitting}>
            {saved ? (
              <><CheckCircle2 className="ml-2 h-4 w-4" />تم الإنشاء</>
            ) : submitting ? (
              "جار الإنشاء..."
            ) : (
              <><Plus className="ml-2 h-4 w-4" />إنشاء المنظمة</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditOrganizationDialog({
  organization,
  onSuccess,
}: {
  organization: SuperadminOrganization;
  onSuccess: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: organization.name,
    slug: organization.slug || "",
    status: organization.status,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm({
        name: organization.name,
        slug: organization.slug || "",
        status: organization.status,
      });
      setError("");
      setSaved(false);
    }
  }, [open, organization]);

  const set = (key: "name" | "slug" | "status", value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("اسم المنظمة مطلوب.");
      return;
    }

    setSubmitting(true);
    setError("");
    const result = await updateSuperadminOrganization(organization.id, form);
    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setSaved(true);
    await onSuccess();
    setTimeout(() => {
      setSaved(false);
      setOpen(false);
    }, 1000);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        تعديل
      </DialogTrigger>
      <DialogContent className="sm:max-w-[430px]">
        <DialogHeader>
          <DialogTitle>تحديث المنظمة</DialogTitle>
          <DialogDescription>تعديل الاسم أو slug أو حالة التشغيل لهذه الجهة.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>اسم المنظمة</Label>
            <Input value={form.name} onChange={(event) => set("name", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input value={form.slug} onChange={(event) => set("slug", event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>الحالة</Label>
            <Input value={form.status} onChange={(event) => set("status", event.target.value)} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>إلغاء</Button>
          <Button className="bg-brand text-white hover:bg-brand-dark" onClick={handleSubmit} disabled={submitting}>
            {saved ? (
              <><CheckCircle2 className="ml-2 h-4 w-4" />تم الحفظ</>
            ) : submitting ? (
              "جار الحفظ..."
            ) : (
              <><Save className="ml-2 h-4 w-4" />حفظ التغييرات</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
