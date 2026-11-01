import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlanCards } from "@/components/PlanCards";
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
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

describe("PlanCards", () => {
  it("shows every plan and marks an existing subscription", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse({
        subscriptions: [
          {
            email: "me@example.com",
            route: "TPE-TYO",
            plan_name: "tokyo",
            target_price: 12000,
            currency: "TWD",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderCards();

    expect(await screen.findByText("已訂閱")).toBeInTheDocument();
    expect(screen.getByText("NT$12,000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新目標價" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "開始追蹤" })).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      `${FLIGHT_API_URL}/subscriptions?email=me%40example.com`,
    );
  });

  it("subscribes to a plan and flips the card to subscribed", async () => {
    let subs: unknown[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toEqual({ email: "me@example.com", plan_name: "seoul", target_price: 7000 });
        const saved = {
          ok: true,
          email: body.email,
          route: "TPE-SEL",
          plan_name: "seoul",
          target_price: 7000,
          currency: "TWD",
        };
        subs = [saved];
        return jsonResponse(saved);
      }
      return jsonResponse({ subscriptions: subs });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderCards();

    const input = await screen.findByLabelText("目標價（新台幣）", { selector: "#target-seoul" });
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "7000" } });
    const card = input.closest("form")!;
    fireEvent.click(within(card).getByRole("button", { name: "開始追蹤" }));

    expect(await screen.findByText("已設定目標價 NT$7,000")).toBeInTheDocument();
    expect(await screen.findByText("已訂閱")).toBeInTheDocument();
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
