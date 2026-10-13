import { useEffect, useState } from "react";

import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { fetchMeta, type Meta } from "@/lib/meta";

export default function PrivacyPage() {
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    fetchMeta().then(setMeta);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {meta ? <SiteHeader meta={meta} installHref="/install" /> : null}

      <main className="flex-1">
        <div className="container max-w-3xl py-14">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated:{" "}
            {new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })}
          </p>

          <div className="mt-8 space-y-8 text-sm leading-6 text-muted-foreground [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            <section className="space-y-2">
              <h2>The short version</h2>
              <p>
                RavenNow does not ask for your name, email, student number or
                Brightspace password. It stores the deadlines it reads from your
                courses so it can show them to you and notice when a due date
                changes.
              </p>
            </section>

            <section className="space-y-2">
              <h2>What we collect</h2>
              <ul>
                <li>
                  A random, anonymous device token that identifies your install.
                </li>
                <li>
                  Course names and codes, and assignment titles, types and due
                  dates read from your Brightspace pages.
                </li>
                <li>Which items you have checked off in RavenNow.</li>
                <li>
                  Basic technical data needed to run the service, such as sync
                  timestamps.
                </li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2>What we do not collect</h2>
              <ul>
                <li>Your name, email or student number.</li>
                <li>Your Brightspace password. RavenNow never sees it.</li>
                <li>
                  Your grades, submissions, discussion posts or any other course
                  content.
                </li>
                <li>Your browsing history outside Brightspace.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2>How it works</h2>
              <p>
                The browser extension reads deadline information from Brightspace
                pages you are already signed in to. It sends that deadline
                information to the RavenNow server, which normalizes and stores it
                so your list stays consistent and changes can be detected between
                syncs.
              </p>
            </section>

            <section className="space-y-2">
              <h2>Third parties</h2>
              <p>
                RavenNow is not affiliated with or endorsed by D2L Corporation or
                Carleton University. We do not sell your data. Data is stored on
                our hosting provider solely to operate the service.
              </p>
            </section>

            <section className="space-y-2">
              <h2>Deleting your data</h2>
              <p>
                You can request deletion of your anonymous account and all
                associated data at any time
                {meta?.support_email ? (
                  <>
                    {" "}
                    by emailing{" "}
                    <a
                      className="font-medium text-foreground underline underline-offset-4"
                      href={`mailto:${meta.support_email}`}
                    >
                      {meta.support_email}
                    </a>
                  </>
                ) : null}
                .
              </p>
            </section>
          </div>
        </div>
      </main>

      {meta ? <SiteFooter meta={meta} /> : null}
    </div>
  );
}
