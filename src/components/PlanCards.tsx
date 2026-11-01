import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PLANS,
  formatTwd,
  listSubscriptions,
  saveSubscription,
  type Plan,
  type Subscription,
} from "@/lib/flightApi";

export function PlanCards({ email }: { email: string }) {
  const normalized = email.trim().toLowerCase();
  const subs = useQuery({
    queryKey: ["subscriptions", normalized],
    queryFn: () => listSubscriptions(normalized),
  });

  return (
    <section aria-label="Plans / 追蹤方案">
      {subs.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          無法載入你的訂閱狀態，請稍後重新整理。Couldn't load your subscriptions.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.name}
            plan={plan}
            email={normalized}
            loading={subs.isPending}
            subscription={subs.data?.find((s) => s.route === plan.route)}
          />
        ))}
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  email,
  loading,
  subscription,
}: {
  plan: Plan;
  email: string;
  loading: boolean;
  subscription: Subscription | undefined;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inputId = `target-${plan.name}`;
  const subscribed = Boolean(subscription);

  const mutation = useMutation({
    mutationFn: (target: number) =>
      saveSubscription({ email, plan_name: plan.name, target_price: target }),
    onSuccess: (saved) => {
      queryClient.setQueryData<Subscription[]>(["subscriptions", email], (prev = []) => [
        ...prev.filter((s) => s.route !== saved.route),
        { ...subscription, ...saved },
      ]);
      void queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });
      setValue("");
      setMessage({ kind: "ok", text: `已設定目標價 ${formatTwd(saved.target_price)}` });
    },
    onError: (err: Error) => setMessage({ kind: "error", text: `儲存失敗：${err.message}` }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const target = Number(value);
    if (!Number.isFinite(target) || target <= 0) {
      setMessage({ kind: "error", text: "請輸入大於 0 的新台幣金額" });
      return;
    }
    setMessage(null);
    mutation.mutate(Math.round(target));
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-7 transition-colors hover:border-primary/60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-primary-glow">
            <Plane className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold">{plan.label}</h2>
            <p className="text-xs text-muted-foreground">
              {plan.labelEn} · {plan.route}
            </p>
          </div>
        </div>
        {subscribed && <Badge>已訂閱</Badge>}
      </div>

      <div className="mt-5 text-sm text-muted-foreground">
        {subscribed ? (
          <p>
            目前目標價{" "}
            <span className="font-semibold text-foreground">
              {formatTwd(subscription!.target_price)}
            </span>
            ，票價低於或等於這個金額時寄 email 通知你。
          </p>
        ) : (
          <p>
            近期最低價參考約 {formatTwd(plan.referenceTwd)}。設定你的目標價，達標就寄 email 給你。
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-auto pt-6">
        <Label htmlFor={inputId}>{subscribed ? "新的目標價（新台幣）" : "目標價（新台幣）"}</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder={String(subscription?.target_price ?? plan.referenceTwd + 1000)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={loading || mutation.isPending}
          />
          <Button type="submit" disabled={loading || mutation.isPending || !value}>
            {mutation.isPending ? "儲存中…" : subscribed ? "更新目標價" : "開始追蹤"}
          </Button>
        </div>
        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`mt-2 text-sm ${message.kind === "error" ? "text-destructive" : "text-primary-glow"}`}
          >
            {message.text}
          </p>
        )}
      </form>
    </div>
  );
}
