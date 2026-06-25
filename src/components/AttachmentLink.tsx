"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AttachmentLinkProps = {
  bucket: string;
  attachment: Record<string, unknown>;
  className?: string;
  children: React.ReactNode;
};

function pathFromPublicUrl(bucket: string, url: string) {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return "";
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return "";
  }
}

function getAttachmentPath(bucket: string, attachment: Record<string, unknown>) {
  const directPath = String(attachment.path || "");
  if (directPath) return directPath;

  const url = String(attachment.url || "");
  return pathFromPublicUrl(bucket, url);
}

export function AttachmentLink({ bucket, attachment, className, children }: AttachmentLinkProps) {
  const fallbackUrl = String(attachment.url || "");
  const path = useMemo(() => getAttachmentPath(bucket, attachment), [attachment, bucket]);
  const [href, setHref] = useState(fallbackUrl || "#");

  useEffect(() => {
    let active = true;

    if (!path) {
      setHref(fallbackUrl || "#");
      return;
    }

    const supabase = createClient();
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60)
      .then((result) => {
        if (!active) return;
        setHref(result.data?.signedUrl || fallbackUrl || "#");
      });

    return () => {
      active = false;
    };
  }, [bucket, fallbackUrl, path]);

  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
