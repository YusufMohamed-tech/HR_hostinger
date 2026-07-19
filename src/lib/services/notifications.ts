function notifyNotificationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notifications:changed"));
  }
}

export async function getNotifications() {
  const response = await fetch("/api/notifications", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  return response.ok
    ? { data: (body.data || []) as Record<string, unknown>[], error: null }
    : { data: null, error: { message: String(body.message || "Unable to load notifications.") } };
}

export async function markNotificationRead(id: string, isRead = true) {
  const response = await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark_one", id, is_read: isRead }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok) notifyNotificationsChanged();
  return response.ok
    ? { data: (body.data || null) as Record<string, unknown> | null, error: null }
    : { data: null, error: { message: String(body.message || "Unable to update notification.") } };
}

export async function markAllNotificationsRead() {
  const response = await fetch("/api/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark_all" }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.ok) notifyNotificationsChanged();
  return response.ok
    ? { data: null, error: null }
    : { data: null, error: { message: String(body.message || "Unable to update notifications.") } };
}
