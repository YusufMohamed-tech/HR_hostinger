"use client";

import React, { useEffect, useMemo, useState } from "react";

type AttachmentLinkProps = {
  bucket: string;
  attachment: Record<string, unknown>;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

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
  if (directPath && !/^https?:\/\//i.test(directPath)) return directPath;

  const url = String(attachment.url || directPath || "");
  return pathFromPublicUrl(bucket, url);
}

export const AttachmentLink = React.forwardRef<HTMLAnchorElement, AttachmentLinkProps>(function AttachmentLink(
  { bucket, attachment, className, children, target, rel, download, ...props },
  ref
) {
  const fallbackUrl = "";
  const path = useMemo(() => getAttachmentPath(bucket, attachment), [attachment, bucket]);
  const [href, setHref] = useState(fallbackUrl || "#");
  const targetValue = target ?? (download ? undefined : "_blank");
  const relValue = rel ?? (targetValue === "_blank" ? "noreferrer" : undefined);

  useEffect(() => {
    let active = true;

    if (!path) {
      setHref(fallbackUrl || "#");
      return;
    }

    fetch("/api/files/signed-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, path }),
    })
      .then(async (response) => ({ response, payload: await response.json().catch(() => null) }))
      .then(({ response, payload }) => {
        if (!active) return;
        setHref(response.ok ? String(payload?.data?.signedUrl || "#") : "#");
      });

    return () => {
      active = false;
    };
  }, [bucket, fallbackUrl, path]);

  return (
    <a ref={ref} href={href} target={targetValue} rel={relValue} download={download} className={className} {...props}>
      {children}
    </a>
  );
});
