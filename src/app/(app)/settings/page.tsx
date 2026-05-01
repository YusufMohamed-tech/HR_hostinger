"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRoleContext } from "@/providers/RoleProvider";
import { LogOut, Shield, User, Building2, Mail, Key } from "lucide-react";

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
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-brand" />
            Account Profile
          </CardTitle>
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
                <Badge className={roleBadgeColor}>{currentUser?.role}</Badge>
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
          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Business details, locations, and branding.</p>
              <Button variant="outline">Edit Profile</Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Roles and Permissions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Define access rules for admins and team leaders.</p>
              <Button variant="outline">Manage Roles</Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Configure alerts for attendance, KPI drift, and payroll.</p>
              <Button variant="outline">Notification Rules</Button>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <CardTitle>Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-gray-500">Audit exports, retention, and approvals.</p>
              <Button variant="outline">Compliance Settings</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Logout */}
      <Card className="border-none shadow-sm border-red-100">
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
