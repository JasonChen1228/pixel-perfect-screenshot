import { Link } from "react-router";
import { Radar, BellRing, CircleX } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Reveal } from "@/components/Reveal";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/lib/head";


const features = [
  { icon: Radar, title: "盯緊熱門航線 (Always-on route watching)", body: "持續監控台北出發的熱門航線（東京、首爾），自動抓最低票價。" },
  { icon: BellRing, title: "達標自動通知 (Target-price email alerts)", body: "低於你設定的目標價，就寄 email 提醒你，附上立即訂購連結。" },
  { icon: CircleX, title: "隨時取消 (Cancel anytime)", body: "月訂閱制，不想用隨時停，沒有綁約。" },
];

export default function Index() {
  usePageMeta({
    title: "Flight Price Notifier — 機票降價通知",
    description:
      "設定航線與目標價，機票降價就通知你。Set a route and a target price — we email you when the fare drops.",
    meta: [
      { property: "og:title", content: "Flight Price Notifier — 機票降價通知" },
      { property: "og:description", content: "Set a route and a target price — we email you when the fare drops." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  });

  return (
    <div className="flex min-h-screen flex-col bg-hero">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Brand />
        <Button asChild>
          <Link to="/signin">Sign in / 登入</Link>
        </Button>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-6 pb-24 pt-20 text-center sm:pt-32">
          <p className="animate-fade-up mb-6 inline-block rounded-full border border-border bg-card/60 px-4 py-1 text-xs text-muted-foreground">
            TPE → TYO · SEL
          </p>
          <h1 className="animate-fade-up text-gradient text-5xl font-bold tracking-tight sm:text-7xl" style={{ animationDelay: "80ms" }}>
            Flight Price Notifier
          </h1>
          <p className="animate-fade-up mt-6 text-xl font-medium sm:text-2xl" style={{ animationDelay: "160ms" }}>
            設定航線與目標價，機票降價就通知你
          </p>
          <p className="animate-fade-up mt-3 text-muted-foreground" style={{ animationDelay: "240ms" }}>
            Set a route and a target price — we email you when the fare drops.
          </p>
          <div className="animate-fade-up mt-10" style={{ animationDelay: "320ms" }}>
            <Button asChild size="lg" className="shadow-glow">
              <Link to="/signup">Get started / 免費註冊</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-24 md:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.title} delay={i * 100}>
              <div className="h-full rounded-2xl border border-border bg-card p-7 transition-colors hover:border-primary/60">
                <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary-glow">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 Flight Price Notifier
      </footer>
    </div>
  );
}
