"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRoleContext } from "@/providers/RoleProvider";
import { LogOut, Shield, User, Building2, Mail, Key, Save, CheckCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export default function SettingsPage() {
  const router = useRouter();
  const { currentUser, logout } = useRoleContext();

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  const roleBadgeColor = {
    "Super Admin": "bg-purple-50 text-purple-700 border-purple-200",
    Admin: "bg-blue-50 text-blue-700 border-blue-200",
    "Team Leader": "bg-amber-50 text-amber-700 border-amber-200",
    Employee: "bg-green-50 text-green-700 border-green-200",
  }[currentUser?.role || "Employee"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-gray-500 text-sm mt-1">
          Manage your account, permissions, and system preferences.
        </p>
      </div>

      {/* User Profile Card */}
      <Card className="border-none shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-brand" />
              Account Profile
            </CardTitle>
            <EditProfileButton />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <User className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">Full Name</p>
                <p className="text-sm font-medium text-gray-900">{currentUser?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Mail className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm font-medium text-gray-900">{currentUser?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Shield className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">Role</p>
                <Badge variant="outline" className={roleBadgeColor}>{currentUser?.role}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Building2 className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">Organization ID</p>
                <p className="text-sm font-medium text-gray-900 font-mono">{currentUser?.orgId}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
              <Key className="w-4 h-4 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">User ID</p>
                <p className="text-sm font-medium text-gray-900 font-mono">{currentUser?.id}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Settings (Admin only) */}
      {(currentUser?.role === "Super Admin" || currentUser?.role === "Admin") && (
        <div className="grid gap-4 md:grid-cols-2">
          <EditCompanyDialog />

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Roles and Permissions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Define access rules for admins and team leaders.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Super Admin</span>
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">Full Access</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Admin</span>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Manage + View</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Team Leader</span>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Team + Schedule</Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">Employee</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">View Only</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Configure alerts for attendance, KPI drift, and payroll.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">Late arrival alerts</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">KPI target drift</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">Payroll approvals</span>
                  <input type="checkbox" className="rounded border-gray-300" />
                </label>
                <label className="flex items-center justify-between text-sm cursor-pointer">
                  <span className="text-gray-700">Shift conflict warnings</span>
                  <input type="checkbox" className="rounded border-gray-300" defaultChecked />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Audit exports, retention, and approvals.</p>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Audit log retention</span>
                  <span className="text-gray-900 font-medium">90 days</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Auto-export schedule</span>
                  <span className="text-gray-900 font-medium">Monthly</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-700">Two-factor auth</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Enabled</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Logout */}
      <Card className="shadow-sm border-red-200">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <p className="font-medium text-gray-900">Sign Out</p>
            <p className="text-sm text-gray-500">End your current session and return to the login page.</p>
          </div>
          <Button
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Edit Company Profile Dialog ─── */

function EditCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    companyName: "Tatwir Talent",
    industry: "Workforce Management",
    country: "Saudi Arabia",
    timezone: "Asia/Riyadh",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
  };

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>Company Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-gray-500">Business details, locations, and branding.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="outline" />}>Edit Profile</DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Company Profile</DialogTitle>
              <DialogDescription>Update your organization details.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Industry</Label>
                <Input value={form.industry} onChange={(e) => set("industry", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave}>
                {saved ? (
                  <><CheckCircle className="w-4 h-4 mr-2" />Saved!</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Save Changes</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/* ─── Edit Profile Button ─── */

function EditProfileButton() {
  const { currentUser } = useRoleContext();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    full_name: currentUser?.name || "",
    phone: "",
    title: "",
  });

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Edit Profile
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your personal details.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+966..." />
          </div>
          <div className="space-y-2">
            <Label>Job Title</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="HR Manager" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button className="bg-brand hover:bg-brand-dark text-white" onClick={handleSave}>
            {saved ? (
              <><CheckCircle className="w-4 h-4 mr-2" />Saved!</>
            ) : (
              <><Save className="w-4 h-4 mr-2" />Save Profile</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
