export interface Meta {
  app_name: string;
  school: string;
  environment: string;
  support_email: string;
  chrome_store_url: string;
  github_url: string;
  extension_download_url: string;
  extension_installer_ps1_url: string;
  extension_installer_sh_url: string;
  reminder_offsets: Record<string, number[]>;
}

const REPO = "https://github.com/mithustar39/ravennow";

export const META_FALLBACK: Meta = {
  app_name: "Raven Scheduling",
  school: "carleton",
  environment: "development",
  support_email: "",
  chrome_store_url: "",
  github_url: REPO,
  extension_download_url: `${REPO}/releases/latest/download/ravennow-extension.zip`,
  extension_installer_ps1_url: `https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.ps1`,
  extension_installer_sh_url: `https://raw.githubusercontent.com/mithustar39/ravennow/main/scripts/install-extension.sh`,
  reminder_offsets: {},
};

export async function fetchMeta(): Promise<Meta> {
  try {
    const res = await fetch("/api/v1/meta", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return META_FALLBACK;
    return { ...META_FALLBACK, ...(await res.json()) };
  } catch {
    return META_FALLBACK;
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
