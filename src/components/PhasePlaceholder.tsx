import React from "react";
import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface PhasePlaceholderProps {
  title: string;
  description: string;
  phaseLabel?: string;
}

export function PhasePlaceholder({
  title,
  description,
  phaseLabel = "Phase 2+",
}: PhasePlaceholderProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-gray-500 text-sm mt-1">{description}</p>
      </div>

      <Card className="border-none shadow-sm">
        <CardContent className="flex flex-col items-center justify-center py-14 text-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10">
            <Clock className="h-6 w-6 text-brand" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Planned for a later phase</p>
            <p className="text-xs text-gray-500 mt-1">This area is intentionally paused while Phase 1 ships.</p>
          </div>
          <Badge variant="outline" className="bg-brand-light text-brand-dark border-brand/20">
            {phaseLabel}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
