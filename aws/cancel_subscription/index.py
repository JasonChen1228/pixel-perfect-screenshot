# flight-cancel-subscription (M2) — POST /cancel  {email, route}
# Calls ECPay CreditCardPeriodAction Action=Cancel (stops future renewals), then sets
# status=cancelled while KEEPING current_period_end (grace) and enqueues {event_type:"cancel"}.
import base64, calendar, hashlib, json, os, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import boto3

TABLE = boto3.resource("dynamodb").Table("subscriptions")
SM = boto3.client("secretsmanager")
SQS = boto3.client("sqs")
TS = "%Y-%m-%dT%H:%M:%SZ"


def _enc(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"), ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def cmv(p, key, iv):
    items = {k: v for k, v in p.items() if k != "CheckMacValue"}
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(_enc(f"HashKey={key}&{body}&HashIV={iv}").encode()).hexdigest().upper()


def add_month(dt):
    y, m = (dt.year + 1, 1) if dt.month == 12 else (dt.year, dt.month + 1)
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def _plain(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError


def _json(code, body):
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, default=_plain, ensure_ascii=False)}


def handler(event, context):
    try:
        raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw = base64.b64decode(raw).decode("utf-8")
        b = json.loads(raw)
    except Exception:
        return _json(400, {"error": "invalid JSON body"})
    key = {"email": str(b.get("email", "")).strip().lower(), "route": str(b.get("route", "")).strip()}
    row = TABLE.get_item(Key=key).get("Item") if key["email"] and key["route"] else None
    if not row:
        return _json(404, {"error": "subscription not found"})
    st = row.get("subscription_status")
    if st == "cancelled":
        return _json(200, {"ok": True, **row})  # idempotent
    if st != "active":
        return _json(409, {"error": "只有付費中的訂閱可以取消 (status: %s)" % st})

    cfg = json.loads(SM.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    host = "payment.ecpay.com.tw" if cfg.get("env") == "prod" else "payment-stage.ecpay.com.tw"
    p = {"MerchantID": cfg["merchant_id"], "MerchantTradeNo": row["merchant_trade_no"],
         "Action": "Cancel", "TimeStamp": str(int(time.time()))}
    p["CheckMacValue"] = cmv(p, cfg["hash_key"], cfg["hash_iv"])
    req = urllib.request.Request(
        f"https://{host}/Cashier/CreditCardPeriodAction", data=urllib.parse.urlencode(p).encode(), method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": "Mozilla/5.0 (compatible; flight-notifier/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = r.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as e:
        # Couldn't reach ECPay: don't pretend renewals stopped.
        print("CreditCardPeriodAction unreachable:", e)
        return _json(502, {"error": "無法連線綠界取消扣款，請稍後再試"})
    rc = urllib.parse.parse_qs(resp, keep_blank_values=True).get("RtnCode", [""])[0]
    print("CreditCardPeriodAction", row["merchant_trade_no"], "->", resp[:300])
    if rc != "1":  # e.g. 90100150 for a never-paid stage order: log and still cancel locally
        print("ECPay cancel returned RtnCode", rc, "- cancelling locally anyway")

    now = datetime.now(timezone.utc)
    end = row.get("current_period_end") or add_month(now).strftime(TS)  # migration fallback
    end_date = (datetime.strptime(end, TS) + timedelta(hours=8)).strftime("%Y-%m-%d")
    item = TABLE.update_item(
        Key=key, UpdateExpression=("SET subscription_status = :c, cancelled_at = :u, current_period_end = :e, "
                                   "current_period_end_date = :ed, updated_at = :u"),
        ExpressionAttributeValues={":c": "cancelled", ":u": now.strftime(TS), ":e": end, ":ed": end_date},
        ReturnValues="ALL_NEW")["Attributes"]
    SQS.send_message(QueueUrl=os.environ["STATUS_QUEUE_URL"], MessageBody=json.dumps({
        "event_type": "cancel", "email": key["email"], "route": key["route"],
        "merchant_trade_no": row["merchant_trade_no"], "current_period_end_date": end_date}, ensure_ascii=False))
    print("cancelled (grace until %s)" % end, key)
    return _json(200, {"ok": True, **item})
