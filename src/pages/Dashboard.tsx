import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { PlanCards } from "@/components/PlanCards";
import { useAuthUser } from "@/components/RequireAuth";
import { usePageMeta } from "@/lib/head";

export default function Dashboard() {
  usePageMeta({
    title: "Dashboard — Flight Price Notifier",
    description: "Your Flight Price Notifier route-tracking dashboard.",
    meta: [
      { property: "og:title", content: "Dashboard — Flight Price Notifier" },
      { property: "og:description", content: "Your route-tracking dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  });
  const user = useAuthUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col bg-hero">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Brand />
        <Button variant="outline" onClick={signOut}>
          Sign out / 登出
        </Button>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-24 pt-16">
        <div className="animate-fade-up mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Hi {user.email}</h1>
          <p className="mt-3 text-lg">
            選一條航線、設定目標價，票價達標時我們會寄 email 到這個信箱。
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a route and a target price (TWD) — we'll email you when the fare drops to it.
          </p>
        </div>
        {user.email ? (
          <PlanCards email={user.email} />
        ) : (
          <p className="text-sm text-muted-foreground">你的帳號沒有 email，無法訂閱通知。</p>
        )}
      </main>
    </div>
  );
}
