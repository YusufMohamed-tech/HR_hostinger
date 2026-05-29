import { ShieldAlert } from "lucide-react";

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6" dir="rtl">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">تم إيقاف الوصول مؤقتًا</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          حسابك أو منظمتك غير مفعلة حاليًا. تواصل مع مسؤول النظام أو فريق الموارد البشرية لإعادة التفعيل.
        </p>
      </div>
    </main>
  );
}
