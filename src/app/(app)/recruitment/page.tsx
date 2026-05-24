"use client";

import React, { useState, useEffect } from "react";
import { useRoleContext } from "@/providers/RoleProvider";
import { getJobPostings, getJobApplications } from "@/lib/services/recruitment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Briefcase, FileText } from "lucide-react";

export default function RecruitmentPage() {
  const { currentUser } = useRoleContext();
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [applications, setApplications] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.orgId) return;
    async function load() {
      setLoading(true);
      const [jData, aData] = await Promise.all([
        getJobPostings(currentUser?.orgId as string),
        getJobApplications(currentUser?.orgId as string)
      ]);
      if (jData.data) setJobs(jData.data);
      if (aData.data) setApplications(aData.data);
      setLoading(false);
    }
    load();
  }, [currentUser?.orgId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">وحدة التوظيف</h1>
          <p className="text-sm text-gray-500">إدارة إعلانات الوظائف والطلبات ومسارات المقابلات.</p>
        </div>
        <div className="flex gap-2">
          {['Admin', 'HR_Admin', 'HR_Recruitment'].includes(currentUser?.role || '') && (
            <Button className="bg-brand hover:bg-brand-dark">
              <Briefcase className="w-4 h-4 ml-2" /> نشر وظيفة جديدة
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-gray-500" />
              <CardTitle>الوظائف النشطة</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-500">جار تحميل الوظائف...</div>
            ) : jobs.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">لا توجد وظائف نشطة.</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>العنوان</TableHead>
                      <TableHead>القسم</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => {
                      const department = (job.department ?? null) as Record<string, unknown> | null;
                      const status = typeof job.status === "string" ? job.status : "open";
                      return (
                      <TableRow key={String(job.id)}>
                        <TableCell className="font-medium">{String(job.title || "بدون عنوان")}</TableCell>
                        <TableCell>{String(department?.name || "الكل")}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={status === 'open' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-700'}>
                            {status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-500" />
              <CardTitle>آخر طلبات التقديم</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-500">جار تحميل طلبات التقديم...</div>
            ) : applications.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-500">لا توجد طلبات تقديم حديثة.</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المرشح</TableHead>
                      <TableHead>الوظيفة</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {applications.slice(0, 10).map((app) => {
                      const job = (app.job ?? null) as Record<string, unknown> | null;
                      const status = typeof app.status === "string" ? app.status : "new";
                      return (
                      <TableRow key={String(app.id)}>
                        <TableCell className="font-medium">
                          {String(app.candidate_name || "المرشح")}
                          <div className="text-xs text-gray-500">{String(app.email || "")}</div>
                        </TableCell>
                        <TableCell>{String(job?.title || "غير معروف")}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={status === 'new' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-700'}>
                            {status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
