import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanCards } from "@/components/PlanCards";
import * as api from "@/lib/flightApi";
import { FLIGHT_API_URL } from "@/lib/flightApi";

function renderCards(email = "Me@Example.com") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlanCards email={email} />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function htmlResponse(body: string) {
  return Promise.resolve(
    new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  );
}

const row = (extra: Record<string, unknown>) => ({
  email: "me@example.com",
  route: "TPE-TYO",
  plan_name: "tokyo",
  target_price: 12000,
  currency: "TWD",
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PlanCards", () => {
  it("shows an active subscription with its paid-through date and a cancel button", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({
        subscriptions: [
          row({ subscription_status: "active", current_period_end_date: "2026-12-02" }),
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCards();

    expect(await screen.findByText("已訂閱（有效）")).toBeInTheDocument();
    expect(screen.getByText("NT$12,000")).toBeInTheDocument();
    expect(screen.getByText(/本期有效至 2026-12-02/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新目標價" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消訂閱" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "開始追蹤" })).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `${FLIGHT_API_URL}/subscriptions?email=me%40example.com`,
    );
  });

  it("treats a legacy row without a status as unpaid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ subscriptions: [row({})] })),
    );
    renderCards();
    expect(await screen.findByText("未完成付款")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成付款 / Pay" })).toBeEnabled();
  });

  it("sends a new subscriber to the ECPay checkout returned as HTML", async () => {
    const checkout = vi.spyOn(api, "goToCheckout").mockImplementation(() => {});
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          email: "me@example.com",
          plan_name: "seoul",
          target_price: 7000,
        });
        return htmlResponse("<form action='https://payment-stage.ecpay.com.tw'></form>");
      }
      return jsonResponse({ subscriptions: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCards();

    const input = await screen.findByLabelText("目標價（新台幣）", { selector: "#target-seoul" });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "7000" } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "開始追蹤" }));

    await waitFor(() => expect(checkout).toHaveBeenCalledWith(expect.stringContaining("ecpay")));
  });

  it("updates an active subscriber's target in place (JSON, no checkout)", async () => {
    const checkout = vi.spyOn(api, "goToCheckout").mockImplementation(() => {});
    let subs = [row({ subscription_status: "active" })];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          subs = [row({ subscription_status: "active", target_price: 9000 })];
          return jsonResponse({ ok: true, ...subs[0] });
        }
        return jsonResponse({ subscriptions: subs });
      }),
    );
    renderCards();
    const input = await screen.findByLabelText("新的目標價（新台幣）", {
      selector: "#target-tokyo",
    });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "更新目標價" }));
    expect(await screen.findByText("已設定目標價 NT$9,000")).toBeInTheDocument();
    expect(checkout).not.toHaveBeenCalled();
  });

  it("cancels an active subscription after confirmation", async () => {
    let subs = [row({ subscription_status: "active", current_period_end_date: "2026-12-02" })];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/cancel")) {
        expect(JSON.parse(String(init.body))).toEqual({
          email: "me@example.com",
          route: "TPE-TYO",
        });
        subs = [row({ subscription_status: "cancelled", current_period_end_date: "2026-12-02" })];
        return jsonResponse({ ok: true, ...subs[0] });
      }
      return jsonResponse({ subscriptions: subs });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCards();

    fireEvent.click(await screen.findByRole("button", { name: "取消訂閱" }));
    fireEvent.click(screen.getByRole("button", { name: "確定取消" }));
    expect(await screen.findByText("已取消")).toBeInTheDocument();
    expect(screen.getByText(/有效至 2026-12-02/)).toBeInTheDocument();
  });

  it("shows the API error message when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? jsonResponse({ error: "target_price must be a positive TWD amount" }, 400)
          : jsonResponse({ subscriptions: [] }),
      ),
    );
    renderCards();
    const input = await screen.findByLabelText("目標價（新台幣）", { selector: "#target-tokyo" });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(within(input.closest("form")!).getByRole("button", { name: "開始追蹤" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "target_price must be a positive TWD amount",
    );
  });
});
