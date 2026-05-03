import React from "react";

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="animate-pulse">
      <div className="h-10 bg-gray-100 rounded-t-lg mb-1" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3.5 px-4 border-b border-gray-50">
          {Array.from({ length: cols }).map((_, j) => (
            <div
              key={j}
              className="h-4 bg-gray-100 rounded-md flex-1"
              style={{ maxWidth: j === 0 ? '40%' : '20%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-100 bg-white p-6 space-y-3 shadow-sm">
      <div className="h-4 bg-gray-100 rounded-md w-1/3" />
      <div className="h-8 bg-gray-100 rounded-md w-1/2" />
      <div className="h-3 bg-gray-100 rounded-md w-2/3" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 bg-gray-100 rounded-md w-48" />
        <div className="h-4 bg-gray-100 rounded-md w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-64 bg-gray-100 rounded-xl shadow-sm" />
        <div className="h-64 bg-gray-100 rounded-xl shadow-sm" />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 bg-gray-100 rounded-md w-48" />
          <div className="h-4 bg-gray-100 rounded-md w-72" />
        </div>
        <div className="h-9 bg-gray-100 rounded-lg w-32" />
      </div>
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <TableSkeleton />
      </div>
    </div>
  );
}
