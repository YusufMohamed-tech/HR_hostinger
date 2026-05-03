"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Users, Trash2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useRoleContext } from "@/providers/RoleProvider";
import { getOrgMembers, removeOrgMember, updateOrgMemberRole } from "@/lib/services/members";
import { PageSkeleton } from "@/components/Skeletons";

const roleBadge = (role: string) => {
  const map: Record<string, string> = {
    super_admin: "bg-purple-50 text-purple-700 border-purple-200",
    admin: "bg-blue-50 text-blue-700 border-blue-200",
    team_leader: "bg-amber-50 text-amber-700 border-amber-200",
    member: "bg-green-50 text-green-700 border-green-200",
  };
  return map[role] || "bg-gray-100 text-gray-600 border-gray-200";
};

export default function MembersPage() {
  const { currentUser } = useRoleContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    if (!currentUser?.orgId) return;
    setLoading(true);
    const { data } = await getOrgMembers(currentUser.orgId);
    setMembers(data || []);
    setLoading(false);
  }, [currentUser?.orgId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from the organization?`)) return;
    await removeOrgMember(id, currentUser?.orgId || "", currentUser?.id);
    fetchMembers();
  };

  const handleRoleChange = async (id: string, newRole: string) => {
    await updateOrgMemberRole(id, currentUser?.orgId || "", newRole, currentUser?.id);
    fetchMembers();
  };

  const isSuperAdmin = currentUser?.role === "Super Admin";

  if (loading) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organization Members</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage users, roles, and access within your organization.
          </p>
        </div>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Member Directory
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50/50 hover:bg-gray-50/50">
                <TableHead className="font-semibold text-gray-600">User</TableHead>
                <TableHead className="font-semibold text-gray-600">Email</TableHead>
                <TableHead className="font-semibold text-gray-600">Role</TableHead>
                <TableHead className="font-semibold text-gray-600">Joined</TableHead>
                {isSuperAdmin && <TableHead className="text-right font-semibold text-gray-600">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium text-gray-900">
                    {member.profiles?.full_name || member.user_id?.slice(0, 8) || "—"}
                  </TableCell>
                  <TableCell className="text-gray-600">{member.profiles?.email || "—"}</TableCell>
                  <TableCell>
                    {isSuperAdmin ? (
                      <Select value={member.role} onValueChange={(v) => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="super_admin">Super Admin</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="team_leader">Team Leader</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline" className={roleBadge(member.role)}>{member.role}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-gray-500 text-xs">
                    {member.created_at ? new Date(member.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  {isSuperAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleRemove(member.id, member.profiles?.full_name || "member")}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {members.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No members found</p>
              <p className="text-xs text-gray-500 mt-1">Organization members will appear here once users are added.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
