"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHierarchy } from "@/hooks/use-data";
import { PageSkeleton } from "@/components/Skeletons";
import { Network, Users } from "lucide-react";

export default function HierarchyPage() {
  const { data: hierarchy, loading } = useHierarchy();

  if (loading) {
    return <PageSkeleton />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Organization Hierarchy</h1>
        <p className="text-gray-500 text-sm mt-1">
          Visualize reporting lines and leadership ownership.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {hierarchy.map((leader) => (
          <Card key={leader.id} className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10">
                  <Users className="h-5 w-5 text-brand" />
                </div>
                <div>
                  <CardTitle className="text-lg">{leader.name}</CardTitle>
                  <p className="text-sm text-gray-500">{leader.title}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">{leader.reports} direct reports</Badge>
                <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">Core leadership</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-none shadow-sm">
        <CardHeader>
          <CardTitle>Org Chart Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
              <Network className="h-6 w-6 text-brand" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700">Interactive org chart coming soon</p>
              <p className="text-xs text-gray-400 mt-1">Visual hierarchy tree will be rendered here</p>
            </div>
            {hierarchy.length > 0 && (
              <div className="flex gap-2 mt-2">
                {hierarchy.map((leader) => (
                  <span key={leader.id} className="text-[10px] bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-500 shadow-sm">
                    👤 {leader.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
