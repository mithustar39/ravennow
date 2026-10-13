export interface Deadline {
  id: number;
  uid: string;
  source: string;
  title: string;
  type: string;
  url: string;
  course_id: number | null;
  course_name: string;
  course_code: string;
  due_at: string | null;
  previous_due_at: string | null;
  changed: boolean;
  submitted: boolean;
  checked: boolean;
  last_seen_at: string | null;
}

export interface ChangeEvent {
  kind: string;
  deadline_id: number | null;
  uid: string | null;
  title: string;
  old_due: string | null;
  new_due: string | null;
  detected_at: string | null;
}

function authHeaders(token: string) {
  return {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    const err = new Error("Request failed (" + res.status + ")");
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getDeadlines(token: string): Promise<Deadline[]> {
  const res = await fetch("/api/v1/deadlines", { headers: authHeaders(token) });
  return jsonOrThrow(res);
}

export async function getChanges(token: string): Promise<ChangeEvent[]> {
  const res = await fetch("/api/v1/changes", { headers: authHeaders(token) });
  return jsonOrThrow(res);
}

export async function checkDeadline(
  token: string,
  id: number,
  checked: boolean
): Promise<Deadline> {
  const res = await fetch(`/api/v1/deadlines/${id}/check`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ checked }),
  });
  return jsonOrThrow(res);
}

export async function seedDemoData(token: string): Promise<void> {
  const res = await fetch("/api/v1/dev/seed", {
    method: "POST",
    headers: authHeaders(token),
  });
  await jsonOrThrow(res);
}

export async function deleteAccount(token: string): Promise<void> {
  const res = await fetch("/api/v1/me", {
    method: "DELETE",
    headers: authHeaders(token),
  });
  await jsonOrThrow(res);
}

export function formatDateTime(value: string | null, withTime = true): string {
  if (!value) return "No date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}
