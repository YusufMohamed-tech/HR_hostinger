"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCourses } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";

const statusClass = (status: string) => {
  if (status === "Completed") return "bg-green-50 text-green-700 border-green-200";
  if (status === "At Risk") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
};

export default function LearningPage() {
  const { data: courses, loading } = useCourses();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Learning and Onboarding</h1>
        <p className="text-gray-500 text-sm mt-1">
          Assign courses, monitor milestones, and track onboarding progress.
        </p>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Active Courses</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {courses.map((course) => (
            <div key={course.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <Link href={`/learning/course/${course.id}`} className="font-semibold text-gray-900 hover:text-brand">
                  {course.title}
                </Link>
                <Badge variant="outline" className={statusClass(course.status)}>{course.status}</Badge>
              </div>
              <p className="text-xs text-gray-500 mt-1">Due {course.due}</p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Progress</span>
                  <span>{course.progress}%</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-brand"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Onboarding Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {["Profile Setup", "Safety Training", "First Shift"].map((step, index) => (
            <div key={step} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-400">Step {index + 1}</p>
              <p className="font-semibold text-gray-900">{step}</p>
              <p className="text-xs text-gray-500 mt-2">Assigned to 28 employees</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
