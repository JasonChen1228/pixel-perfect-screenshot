"""flight-parser: one route per invocation.

Fetch the cheapest fare for next month (TWD is the gate, USD is best-effort),
scan subscriptions for that route, and enqueue every PAYING subscriber whose TWD
target is met.

M2 paywall (grace-aware): a row is served if subscription_status == "active", or
"cancelled" with current_period_end still in the future. A cancelled row whose
period has lapsed is lazily flipped to "expired" here. pending_payment / expired /
legacy rows with no status are never served.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr

UA = "Mozilla/5.0 (compatible; flight-notifier/1.0)"
QUEUE_NAME = os.environ.get("FARE_QUEUE_NAME", "flight-fare-queue")
TS = "%Y-%m-%dT%H:%M:%SZ"  # same fixed-width UTC format every writer uses (string compare)

_sm = boto3.client("secretsmanager")
_sqs = boto3.client("sqs")
_table = boto3.resource("dynamodb").Table("subscriptions")
_token = None
_qurl = None


def _get_token():
    global _token
    if _token is None:
        _token = json.loads(_sm.get_secret_value(SecretId="flight/travelpayouts")["SecretString"])["token"]
    return _token


def _queue_url():
    global _qurl
    if _qurl is None:
        _qurl = _sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]
    return _qurl


def next_month(now=None):
    now = now or datetime.now(timezone.utc)
    y, m = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return f"{y:04d}-{m:02d}"


def fetch_cheapest(origin, destination, month, token, currency):
    q = urllib.parse.urlencode({"origin": origin, "destination": destination, "depart_date": month,
                                "currency": currency, "token": token})
    req = urllib.request.Request(f"https://api.travelpayouts.com/v1/prices/cheap?{q}",
                                 headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as ex:
        print(f"travelpayouts {currency} HTTP {ex.code} for {origin}-{destination}")
        return None
    except (urllib.error.URLError, TimeoutError, ValueError) as ex:
        print(f"travelpayouts {currency} error for {origin}-{destination}: {ex}")
        return None
    if not body.get("success") or not body.get("data"):
        return None
    offers = body["data"].get(destination, {})
    if not offers:
        return None
    best = min(offers.values(), key=lambda o: o["price"])
    return {"price": best["price"], "currency": currency.upper(), "airline": best.get("airline"),
            "depart_date": best.get("departure_at"), "return_date": best.get("return_at")}


def _subscribers(route):
    kwargs = {"FilterExpression": Attr("route").eq(route)}
    while True:
        page = _table.scan(**kwargs)
        yield from page.get("Items", [])
        if "LastEvaluatedKey" not in page:
            return
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _served(it, now_ts):
    """Grace-aware paywall gate. Returns True if this subscriber should get alerts."""
    status = it.get("subscription_status")
    if status == "active":
        return True
    if status == "cancelled":
        if str(it.get("current_period_end", "")) >= now_ts:
            return True  # cancelled but still paid-through
        try:
            _table.update_item(Key={"email": it["email"], "route": it["route"]},
                               UpdateExpression="SET subscription_status = :e, updated_at = :u",
                               ConditionExpression="subscription_status = :c",
                               ExpressionAttributeValues={":e": "expired", ":c": "cancelled", ":u": now_ts})
            print(f"gate: {it['email']} {it['route']} cancelled + period lapsed -> expired")
        except _table.meta.client.exceptions.ConditionalCheckFailedException:
            pass
    return False


def handler(event, context):
    origin = event["origin"]
    destination = event["destination"]
    route = event.get("route") or f"{origin}-{destination}"
    month = event.get("month") or next_month()
    token = _get_token()

    tw = fetch_cheapest(origin, destination, month, token, "twd")
    if not tw:
        print(f"no TWD fare for {route} {month} (empty/429) - skipping")
        return {"ok": True, "route": route, "matched": 0}
    us = fetch_cheapest(origin, destination, month, token, "usd")  # may be None; never block on it
    print(f"{route} {month} cheapest {tw['price']} TWD ({tw['airline']})"
          + (f", {us['price']} USD" if us else ", USD unavailable"))

    cheapest = Decimal(str(tw["price"]))
    now_ts = datetime.now(timezone.utc).strftime(TS)
    matched = skipped = 0
    for it in _subscribers(route):
        if not _served(it, now_ts):
            skipped += 1
            print(f"gate: skip {it.get('email')} {route} status={it.get('subscription_status')}")
            continue
        tp = it.get("target_price")
        if tp is None or Decimal(tp) < cheapest:
            continue
        body = {"email": it["email"], "route": route, "plan_name": it.get("plan_name"),
                "target_price": int(tp),
                "cheapest": {"price": tw["price"], "currency": "TWD", "airline": tw["airline"],
                             "depart_date": tw["depart_date"], "return_date": tw["return_date"]}}
        if us:
            body["cheapest_usd"] = {"price": us["price"], "currency": "USD", "airline": us["airline"],
                                    "depart_date": us["depart_date"], "return_date": us["return_date"]}
        _sqs.send_message(QueueUrl=_queue_url(), MessageBody=json.dumps(body))
        matched += 1
        print(f"gate: enqueue {it['email']} {route} status={it.get('subscription_status')}")
    print(f"{route}: enqueued {matched} match(es), {skipped} not paying")
    return {"ok": True, "route": route, "month": month, "cheapest_twd": tw["price"],
            "matched": matched, "skipped_unpaid": skipped}
