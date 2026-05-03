"use client";

import React from "react";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useCourses } from "@/hooks/use-data";
import { useRoleContext } from "@/providers/RoleProvider";
import { AddCourseDialog } from "@/components/forms/AddCourseDialog";
import { PageSkeleton } from "@/components/Skeletons";

const statusClass = (status: string) => {
  if (status === "Completed") return "bg-green-50 text-green-700 border-green-200";
  if (status === "At Risk") return "bg-red-50 text-red-700 border-red-200";
  return "bg-blue-50 text-blue-700 border-blue-200";
};

export default function LearningPage() {
  const { currentUser } = useRoleContext();
  const { data: courses, loading, refetch } = useCourses();
  const isAdmin = currentUser?.role === "Super Admin" || currentUser?.role === "Admin";

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Learning (LMS)</h1>
          <p className="text-gray-500 text-sm mt-1">
            Track training assignments, certifications, and compliance.
          </p>
        </div>
        {isAdmin && <AddCourseDialog onSuccess={refetch} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <Card key={course.id} className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Link href={`/learning/course/${course.id}`} className="font-semibold text-gray-900 hover:text-brand">
                  {course.title}
                </Link>
                <Badge variant="outline" className={statusClass(course.status)}>{course.status}</Badge>
              </div>
              <p className="text-xs text-gray-500 mt-1">Due {course.due || "—"}</p>
            </CardHeader>
            <CardContent>
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>Progress</span>
                  <span>{course.progress ?? 0}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-500"
                    style={{ width: `${course.progress ?? 0}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {courses.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <GraduationCap className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-900">No courses yet</p>
          <p className="text-xs text-gray-500 mt-1">Create your first course to start training employees.</p>
        </div>
      )}
    </div>
  );
}
