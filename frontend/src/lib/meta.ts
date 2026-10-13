export interface Meta {
  app_name: string;
  school: string;
  environment: string;
  support_email: string;
  chrome_store_url: string;
  github_url: string;
  reminder_offsets: Record<string, number[]>;
}

const FALLBACK: Meta = {
  app_name: "RavenNow",
  school: "carleton",
  environment: "development",
  support_email: "",
  chrome_store_url: "",
  github_url: "",
  reminder_offsets: {},
};

export async function fetchMeta(): Promise<Meta> {
  try {
    const res = await fetch("/api/v1/meta", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return FALLBACK;
    return { ...FALLBACK, ...(await res.json()) };
  } catch {
    return FALLBACK;
  }
}

export async function submitFeedback(input: {
  message: string;
  email?: string;
}): Promise<void> {
  const res = await fetch("/api/v1/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      email: input.email ?? "",
      school: "carleton",
    }),
  });
  if (!res.ok) throw new Error("Could not send feedback (" + res.status + ")");
}
