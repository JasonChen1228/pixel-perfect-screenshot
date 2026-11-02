# flight-status-notification (M2) — SQS consumer of flight-status-queue (BatchSize=1)
# ONE consumer for both subscription emails, routed by message["event_type"]:
#   "welcome" -> 訂閱成功信   "cancel" -> 取消確認信
# Dedup in notification_history (pk "status#<event>#<email>#<route>#<trade-no>") so ECPay
# callback resends / SQS redeliveries never send twice. 429/5xx -> retry; 403/422 -> drop.
import json, os, urllib.error, urllib.request
from datetime import datetime, timezone
import boto3
from boto3.dynamodb.conditions import Key

HIST = boto3.resource("dynamodb").Table("notification_history")
SM = boto3.client("secretsmanager")
_cfg = None
ROUTES = {"TPE-TYO": "台北 → 東京", "TPE-SEL": "台北 → 首爾", "TPE-LON": "台北 → 倫敦"}


def _resend():
    global _cfg
    if _cfg is None:
        _cfg = json.loads(SM.get_secret_value(SecretId="flight/resend")["SecretString"])
    return _cfg


def _render(m):
    route = ROUTES.get(m["route"], m["route"])
    end = m.get("current_period_end_date", "")
    site = os.environ.get("SITE_URL", "").rstrip("/")
    link = f'<p><a href="{site}/app">管理我的訂閱</a></p>' if site else ""
    if m["event_type"] == "welcome":
        subject = f"✈️ 訂閱成功：{route} 機票降價通知已啟用"
        lines = [f"感謝訂閱 Flight Price Notifier！{route} 的降價通知已啟用。",
                 f"月費 NT${m.get('amount', 0):,}，本期有效至 {end}，之後每月自動續訂。",
                 f"票價低於或等於你的目標價 NT${m.get('target_price', 0):,} 時，我們會寄信通知你。"]
    else:
        subject = f"已取消訂閱：{route} 機票降價通知"
        lines = [f"你已取消 {route} 的訂閱，之後不會再自動扣款。",
                 f"已付費的這一期到 {end} 為止，在那之前你仍會收到降價通知。",
                 "隨時可以回到網站重新訂閱。"]
    html = "".join(f"<p>{l}</p>" for l in lines) + link + "<p>— Flight Price Notifier</p>"
    text = "\n".join(lines) + (f"\n管理我的訂閱：{site}/app" if site else "") + "\n— Flight Price Notifier"
    return subject, html, text


def _send(to, subject, html, text):
    c = _resend()
    req = urllib.request.Request(
        "https://api.resend.com/emails", method="POST",
        data=json.dumps({"from": c["from"], "to": to, "subject": subject, "html": html, "text": text}).encode(),
        headers={"Authorization": "Bearer " + c["api_key"], "Content-Type": "application/json",
                 "User-Agent": "Mozilla/5.0 (compatible; flight-notifier/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def handler(event, context):
    for rec in event.get("Records", []):
        m = json.loads(rec["body"])
        et = m.get("event_type")
        if et not in ("welcome", "cancel") or not m.get("email"):
            print("dropping unknown message", rec["body"][:200])
            continue
        pk = f"status#{et}#{m['email']}#{m['route']}#{m.get('merchant_trade_no', '')}"
        if HIST.query(KeyConditionExpression=Key("pk").eq(pk), Limit=1).get("Items"):
            print("skipped (already sent)", pk)
            continue
        subject, html, text = _render(m)
        status, body = _send(m["email"], subject, html, text)
        print("resend", et, m["email"], status, body[:200])
        if 200 <= status < 300:
            HIST.put_item(Item={"pk": pk, "sent_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "email": m["email"], "route": m["route"], "event_type": et})
        elif status == 429 or status >= 500:
            raise RuntimeError(f"transient Resend error {status}")  # SQS redelivers
        else:
            print("permanent Resend error -> dropped")  # 403/422: never succeeds on retry
    return {"ok": True}
