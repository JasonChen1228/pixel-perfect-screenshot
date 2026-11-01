// Client for the Flight Price Notifier API (AWS API Gateway → Lambda → DynamoDB).
// The browser holds no AWS credentials: it only calls these public HTTP endpoints.
// Subscription data lives in DynamoDB; Supabase is used for sign-in only.

const DEFAULT_API_URL = "https://otcin1mp63.execute-api.us-east-1.amazonaws.com";

export const FLIGHT_API_URL = (
  (import.meta.env["VITE_FLIGHT_API_URL"] as string | undefined) || DEFAULT_API_URL
).replace(/\/+$/, "");

export type PlanName = "tokyo" | "seoul" | "london";

export type Plan = {
  name: PlanName;
  route: string;
  label: string;
  labelEn: string;
  referenceTwd: number;
};

export const PLANS: Plan[] = [
  {
    name: "tokyo",
    route: "TPE-TYO",
    label: "台北 ✈ 東京",
    labelEn: "Taipei → Tokyo",
    referenceTwd: 8449,
  },
  {
    name: "seoul",
    route: "TPE-SEL",
    label: "台北 ✈ 首爾",
    labelEn: "Taipei → Seoul",
    referenceTwd: 6963,
  },
  {
    name: "london",
    route: "TPE-LON",
    label: "台北 ✈ 倫敦",
    labelEn: "Taipei → London",
    referenceTwd: 30847,
  },
];

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  target_price: number;
  currency: "TWD";
  created_at?: string;
  updated_at?: string;
};

async function readJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body;
}

export async function listSubscriptions(email: string): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?email=${encodeURIComponent(email)}`);
  const body = (await readJson(res)) as { subscriptions?: Subscription[] };
  return body.subscriptions ?? [];
}

export async function saveSubscription(input: {
  email: string;
  plan_name: PlanName;
  target_price: number;
}): Promise<Subscription> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await readJson(res)) as Subscription;
}

export function formatTwd(n: number) {
  return `NT$${Math.round(n).toLocaleString("en-US")}`;
}
