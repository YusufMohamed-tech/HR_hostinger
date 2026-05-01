import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Browser-side Supabase client (uses anon key).
 * Safe to use in "use client" components.
 * All queries are subject to Row Level Security.
 *
 * During Vercel static prerendering, env vars may be undefined.
 * We provide a placeholder so the build doesn't crash — the
 * client is never actually called during SSG because all pages
 * using it are "use client" and only execute in the browser.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key";

export function createClient() {
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
