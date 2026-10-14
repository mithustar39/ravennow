import { useEffect, useState } from "react";
import {
  BellRing,
  Chrome,
  Download,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { DeadlinePreview } from "@/components/site/deadline-preview";
import { FeedbackForm } from "@/components/site/feedback-form";
import { fetchMeta, type Meta } from "@/lib/meta";

const FEATURES = [
  {
    icon: ListChecks,
    title: "Every deadline in one list",
    body: "Raven Scheduling reads your courses on Brightspace and lists every assignment, quiz, lab and discussion in the side panel. No syllabus upload, no calendar import.",
  },
  {
    icon: RefreshCw,
    title: "Moved dates are caught",
    body: "When a due date changes on Brightspace, the old one is crossed out and the item moves to the week it is due now, even if you missed the announcement.",
  },
  {
    icon: BellRing,
    title: "Reminders you control",
    body: "Assignments, quizzes and labs each get their own reminder timing. Switch off a whole course or a whole deadline type whenever you like.",
  },
  {
    icon: ShieldCheck,
    title: "No account, no personal info",
    body: "Raven Scheduling never asks for your name, student number or Brightspace password. It only stores the deadlines it already shows you.",
  },
];

const STEPS = [
  {
    title: "Add the extension",
    body: "Download it and load it into Chrome or Edge. It takes about a minute.",
  },
  {
    title: "Open Brightspace once",
    body: "Sign in as usual. Raven Scheduling reads your courses and builds the list in the side panel.",
  },
  {
    title: "Check the side panel",
    body: "It re-checks every 30 minutes and flags anything a prof has moved.",
  },
];

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    fetchMeta().then(setMeta);
  }, []);

  const config = meta;
  const installHref = config?.chrome_store_url || "/install";
  const installLabel = config?.chrome_store_url
    ? "Add to Chrome"
    : "Install Raven Scheduling";

  return (
    <div className="flex min-h-screen flex-col">
      {config ? (
        <SiteHeader
          meta={config}
          installHref={installHref}
          installLabel={installLabel}
        />
      ) : null}

      <main className="flex-1">
        {/* Hero */}
        <section className="border-b">
          <div className="container grid gap-12 py-16 md:grid-cols-2 md:items-center md:py-24">
            <div className="space-y-6">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Every Brightspace deadline, kept up to date when profs move them.
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                Stop rebuilding your calendar every term. Raven Scheduling reads your
                deadlines from Brightspace and keeps them current in a browser
                side panel.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <a href={installHref}>
                    <Chrome className="h-4 w-4" />
                    {installLabel}
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="/app">Open the dashboard</a>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Free. Works in Chrome and Edge. Brightspace only.
              </p>
            </div>
            <DeadlinePreview />
          </div>
        </section>

        {/* Features */}
        <section id="how" className="container py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              What it does
            </h2>
            <p className="mt-3 text-muted-foreground">
              A small tool that does one job well: keep your deadlines straight.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <feature.icon className="h-5 w-5 text-brand" />
                  <CardTitle className="pt-2 text-base">{feature.title}</CardTitle>
                  <CardDescription>{feature.body}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y bg-muted/30">
          <div className="container py-16 md:py-20">
            <div className="grid gap-10 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <div key={step.title} className="space-y-2">
                  <div className="grid h-8 w-8 place-items-center rounded-full border bg-background text-sm font-medium">
                    {index + 1}
                  </div>
                  <h3 className="text-base font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Install */}
        <section id="install" className="container py-16 md:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Get Raven Scheduling</h2>
            <p className="mt-3 text-muted-foreground">
              Available now for Chrome and Edge. Firefox and Safari are planned.
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-4xl gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <Badge variant="secondary" className="w-fit">
                  Recommended
                </Badge>
                <CardTitle className="pt-2 text-lg">
                  Install in about a minute
                </CardTitle>
                <CardDescription>
                  Works in Chrome and Edge on Windows, macOS and Linux.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button asChild>
                  <a href={config?.chrome_store_url || "/install"}>
                    <Download className="h-4 w-4" />
                    {config?.chrome_store_url
                      ? "Add to Chrome"
                      : "Get the extension"}
                  </a>
                </Button>
                <p className="text-sm text-muted-foreground">
                  {config?.chrome_store_url
                    ? "One click, with automatic updates."
                    : "Raven Scheduling is not in a store yet, so you load it from a zip once. The steps and a one-line script are on the install page."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Terminal className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="pt-2 text-lg">Build from source</CardTitle>
                <CardDescription>
                  Clone the repo to load the extension, or run the backend too.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Clone or download the repo
                    {config?.github_url ? (
                      <>
                        {" "}
                        from{" "}
                        <a
                          className="font-medium text-foreground underline underline-offset-4"
                          href={config.github_url}
                        >
                          GitHub
                        </a>
                      </>
                    ) : null}
                    .
                  </li>
                  <li>
                    Open <code className="rounded bg-muted px-1">chrome://extensions</code>{" "}
                    and turn on <em>Developer mode</em>.
                  </li>
                  <li>
                    Click <em>Load unpacked</em> and select the{" "}
                    <code className="rounded bg-muted px-1">extension/</code>{" "}
                    folder.
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Feedback */}
        <section id="feedback" className="border-t bg-muted/30">
          <div className="container py-16 md:py-20">
            <div className="mx-auto grid max-w-4xl gap-10 md:grid-cols-2 md:items-start">
              <div className="space-y-3">
                <h2 className="text-3xl font-semibold tracking-tight">
                  Feedback &amp; requests
                </h2>
                <p className="text-muted-foreground">
                  Found a bug, or want a feature or another school supported? Send
                  it here and it goes straight to the developer.
                </p>
                {config?.support_email ? (
                  <p className="text-sm text-muted-foreground">
                    Prefer email?{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-4"
                      href={`mailto:${config.support_email}`}
                    >
                      {config.support_email}
                    </a>
                  </p>
                ) : null}
              </div>
              <Card>
                <CardContent className="pt-6">
                  <FeedbackForm />
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      {config ? <SiteFooter meta={config} /> : null}
    </div>
  );
}
