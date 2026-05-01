"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCourses } from "@/hooks/use-data";

export default function CourseDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: courses } = useCourses();
  const course = courses.find((item: Record<string, unknown>) => item.id === id);

  if (!course) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Course not found</h1>
        <Button asChild variant="outline">
          <Link href="/learning">Back to learning</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{course.title}</h1>
          <p className="text-gray-500 text-sm mt-1">Course milestones and completion status.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/learning">Back to learning</Link>
        </Button>
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Course Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge className={course.status === "Completed" ? "bg-green-50 text-green-700 border-green-200" : course.status === "At Risk" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
            {course.status}
          </Badge>
          <p className="text-sm text-gray-600">Due date: {course.due}</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Progress</span>
              <span>{course.progress}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-brand" style={{ width: `${course.progress}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span>Module 1: Introduction</span>
            <Badge className="bg-green-50 text-green-700 border-green-200">Completed</Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span>Module 2: Safety Procedures</span>
            <Badge className="bg-amber-50 text-amber-700 border-amber-200">In Progress</Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
            <span>Module 3: Assessment</span>
            <Badge className="bg-gray-100 text-gray-600 border-gray-200">Pending</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
