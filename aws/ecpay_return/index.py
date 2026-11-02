# flight-ecpay-return (M2) — POST /ecpay-return  (ECPay ReturnURL: FIRST charge)
# Source of truth for activation: verify CheckMacValue -> active + current_period_end
# -> enqueue {event_type:"welcome"} -> reply plain-text 1|OK.
import base64, calendar, hashlib, hmac, json, os, urllib.parse
from datetime import datetime, timedelta, timezone
import boto3

TABLE = boto3.resource("dynamodb").Table("subscriptions")
SM = boto3.client("secretsmanager")
SQS = boto3.client("sqs")
TS = "%Y-%m-%dT%H:%M:%SZ"
LOG = ("MerchantTradeNo", "RtnCode", "RtnMsg", "TradeAmt", "PeriodType", "Frequency", "ExecTimes",
       "TotalSuccessTimes", "Gwsr", "SimulatePaid", "CustomField1", "CustomField2", "PaymentDate")


def _enc(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"), ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def cmv(p, key, iv):
    items = {k: v for k, v in p.items() if k != "CheckMacValue"}  # keep "" values
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(_enc(f"HashKey={key}&{body}&HashIV={iv}").encode()).hexdigest().upper()


def add_period(dt, ptype, freq):
    if ptype == "D":
        return dt + timedelta(days=freq)
    months = freq * (12 if ptype == "Y" else 1)
    m = dt.month - 1 + months
    y, m = dt.year + m // 12, m % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def _text(body, status=200):
    return {"statusCode": status, "headers": {"Content-Type": "text/plain; charset=utf-8"}, "body": body}


def _form(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    return {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}


def handler(event, context):
    p = _form(event)
    cfg = json.loads(SM.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    print("ReturnURL", json.dumps({k: p.get(k) for k in LOG}, ensure_ascii=False))
    if not hmac.compare_digest(p.get("CheckMacValue", "").upper(), cmv(p, cfg["hash_key"], cfg["hash_iv"])):
        print("CheckMacValue INVALID")
        return _text("0|CheckMacValueInvalid", 400)
    if p.get("MerchantID") != cfg["merchant_id"]:
        print("MerchantID mismatch")
        return _text("0|MerchantIDMismatch", 400)
    print("CMV verified")
    if p.get("SimulatePaid") == "1":
        print("SimulatePaid=1 -> ack only, NOT activating")
        return _text("1|OK")
    if p.get("RtnCode") != "1":
        print("first authorization failed -> row stays pending_payment")
        return _text("1|OK")

    email, route = p.get("CustomField1", "").strip().lower(), p.get("CustomField2", "").strip()
    mtn = p.get("MerchantTradeNo", "")
    if not email or not route:
        print("missing CustomField1/2 -> cannot locate row")
        return _text("1|OK")
    row = TABLE.get_item(Key={"email": email, "route": route}).get("Item")
    if not row:
        print("no subscriptions row for", email, route)
        return _text("1|OK")

    now = datetime.now(timezone.utc)
    ptype = p.get("PeriodType") or row.get("period_type") or "M"
    freq = int(p.get("Frequency") or 1)
    end = add_period(now, ptype, freq)
    try:
        TABLE.update_item(
            Key={"email": email, "route": route},
            UpdateExpression=("SET subscription_status = :a, merchant_trade_no = :m, period_type = :pt, "
                              "current_period_end = :e, current_period_end_date = :ed, activated_at = :u, "
                              "last_charged_at = :u, total_success_times = :one, failed_attempts = :z, updated_at = :u"),
            ConditionExpression="attribute_not_exists(subscription_status) OR subscription_status <> :a OR merchant_trade_no <> :m",
            ExpressionAttributeValues={":a": "active", ":m": mtn, ":pt": ptype, ":e": end.strftime(TS),
                                       ":ed": (end + timedelta(hours=8)).strftime("%Y-%m-%d"),
                                       ":u": now.strftime(TS), ":one": 1, ":z": 0})
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        print("already active for", mtn, "-> idempotent ack")
        return _text("1|OK")
    print("UpdateItem -> active", email, route, mtn, "until", end.strftime(TS))
    SQS.send_message(QueueUrl=os.environ["STATUS_QUEUE_URL"], MessageBody=json.dumps({
        "event_type": "welcome", "email": email, "route": route, "merchant_trade_no": mtn,
        "target_price": int(row.get("target_price", 0)), "amount": int(cfg["amount"]),
        "current_period_end_date": (end + timedelta(hours=8)).strftime("%Y-%m-%d")}, ensure_ascii=False))
    return _text("1|OK")
