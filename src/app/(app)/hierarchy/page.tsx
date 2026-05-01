"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hierarchy } from "@/data/mock";

export default function HierarchyPage() {
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
              <CardTitle className="text-lg">{leader.name}</CardTitle>
              <p className="text-sm text-gray-500">{leader.title}</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge className="bg-brand-light text-brand-dark border-brand/20">{leader.reports} direct reports</Badge>
                <Badge className="bg-gray-100 text-gray-600 border-gray-200">Core leadership</Badge>
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
          <div className="h-[280px] rounded-xl border border-dashed border-gray-200 bg-white flex items-center justify-center text-sm text-gray-400">
            Org chart visualization will be rendered here.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
