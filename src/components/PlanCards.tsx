import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MONTHLY_FEE_TWD,
  PLANS,
  cancelSubscription,
  formatTwd,
  goToCheckout,
  listSubscriptions,
  saveSubscription,
  statusOf,
  type Plan,
  type SaveResult,
  type Subscription,
} from "@/lib/flightApi";

export function PlanCards({
  email,
  pollPending = false,
}: {
  email: string;
  pollPending?: boolean;
}) {
  const normalized = email.trim().toLowerCase();
  const subs = useQuery({
    queryKey: ["subscriptions", normalized],
    queryFn: () => listSubscriptions(normalized),
    // Right after paying, the ECPay callback may land a few seconds after the browser does.
    refetchInterval: (q) =>
      pollPending && (q.state.data ?? []).some((s) => statusOf(s) === "pending_payment")
        ? 3000
        : false,
  });

  return (
    <section aria-label="Plans / 追蹤方案">
      {subs.isError && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          無法載入你的訂閱狀態，請稍後重新整理。Couldn't load your subscriptions.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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

const BADGES = {
  active: { text: "已訂閱（有效）", variant: "default" },
  pending_payment: { text: "未完成付款", variant: "outline" },
  cancelled: { text: "已取消", variant: "secondary" },
  expired: { text: "已結束", variant: "secondary" },
} as const;

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
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inputId = `target-${plan.name}`;
  const status = statusOf(subscription);
  const paid = status === "active" || status === "cancelled"; // target updates in place
  const until = subscription?.current_period_end_date;

  function storeRow(row: Subscription) {
    queryClient.setQueryData<Subscription[]>(["subscriptions", email], (prev = []) => [
      ...prev.filter((s) => s.route !== row.route),
      { ...subscription, ...row },
    ]);
    void queryClient.invalidateQueries({ queryKey: ["subscriptions", email] });
  }

  const save = useMutation({
    mutationFn: (target: number) =>
      saveSubscription({ email, plan_name: plan.name, target_price: target }),
    onSuccess: (result: SaveResult) => {
      if (result.kind === "checkout") {
        setMessage({ kind: "ok", text: "正在前往綠界付款頁…" });
        goToCheckout(result.html);
        return;
      }
      storeRow(result.subscription);
      setValue("");
      setMessage({
        kind: "ok",
        text: `已設定目標價 ${formatTwd(result.subscription.target_price)}`,
      });
    },
    onError: (err: Error) => setMessage({ kind: "error", text: `儲存失敗：${err.message}` }),
  });

  const cancel = useMutation({
    mutationFn: () => cancelSubscription({ email, route: plan.route }),
    onSuccess: (row) => {
      storeRow(row);
      setConfirming(false);
      setMessage({
        kind: "ok",
        text: `已取消訂閱，${row.current_period_end_date ?? "本期結束"} 前仍會收到通知。`,
      });
    },
    onError: (err: Error) => {
      setConfirming(false);
      setMessage({ kind: "error", text: `取消失敗：${err.message}` });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // "完成付款" / "重新訂閱" may be pressed with an empty input: reuse the saved target.
    const target = Number(value || subscription?.target_price);
    if (!Number.isFinite(target) || target <= 0) {
      setMessage({ kind: "error", text: "請輸入大於 0 的新台幣金額" });
      return;
    }
    setMessage(null);
    save.mutate(Math.round(target));
  }

  const busy = loading || save.isPending || cancel.isPending;
  const submitLabel = save.isPending
    ? "處理中…"
    : {
        none: "開始追蹤",
        pending_payment: "完成付款 / Pay",
        active: "更新目標價",
        cancelled: "更新目標價",
        expired: "重新訂閱",
      }[status];
  const needsValue = status === "none" || paid;

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
        {status !== "none" && <Badge variant={BADGES[status].variant}>{BADGES[status].text}</Badge>}
      </div>

      <div className="mt-5 space-y-2 text-sm text-muted-foreground">
        {status === "none" ? (
          <p>
            近期最低價參考約 {formatTwd(plan.referenceTwd)}。設定目標價並訂閱（每月{" "}
            {formatTwd(MONTHLY_FEE_TWD)}），達標就寄 email 給你。
          </p>
        ) : (
          <p>
            目標價{" "}
            <span className="font-semibold text-foreground">
              {formatTwd(subscription!.target_price)}
            </span>
            {paid ? "，票價低於或等於這個金額時寄 email 通知你。" : "。"}
          </p>
        )}
        {status === "active" && until && <p>本期有效至 {until}，之後每月自動續訂。</p>}
        {status === "cancelled" && (
          <p>已取消自動續訂，{until ? `有效至 ${until}` : "本期結束前"}，在那之前仍會通知你。</p>
        )}
        {status === "pending_payment" && (
          <p>尚未完成付款，付款後才會開始寄送降價通知（每月 {formatTwd(MONTHLY_FEE_TWD)}）。</p>
        )}
        {status === "expired" && <p>訂閱已結束，重新訂閱即可恢復通知。</p>}
      </div>

      <form onSubmit={onSubmit} className="mt-auto pt-6">
        <Label htmlFor={inputId}>
          {status === "none" ? "目標價（新台幣）" : "新的目標價（新台幣）"}
        </Label>
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
            disabled={busy}
          />
          <Button type="submit" disabled={busy || (needsValue && !value)}>
            {submitLabel}
          </Button>
        </div>
        {status === "active" && (
          <div className="mt-3 flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">確定取消自動續訂？</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => cancel.mutate()}
                >
                  {cancel.isPending ? "取消中…" : "確定取消"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  不要
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="px-0 text-muted-foreground"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                取消訂閱
              </Button>
            )}
          </div>
        )}
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
