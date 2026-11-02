# flight-ecpay-period (M2) — POST /ecpay-period  (ECPay PeriodReturnURL: 2nd charge onward)
# Success -> extend current_period_end. Failure -> count it; only ECPay's 6th consecutive
# failure (auto-terminated contract) expires the row. Last scheduled charge -> cancelled (grace).
import base64, calendar, hashlib, hmac, json, urllib.parse
from datetime import datetime, timedelta, timezone
import boto3
from boto3.dynamodb.conditions import Attr

TABLE = boto3.resource("dynamodb").Table("subscriptions")
SM = boto3.client("secretsmanager")
TS = "%Y-%m-%dT%H:%M:%SZ"
LOG = ("MerchantTradeNo", "RtnCode", "RtnMsg", "Amount", "PeriodType", "Frequency", "ExecTimes",
       "TotalSuccessTimes", "ProcessDate", "SimulatePaid", "CustomField1", "CustomField2")


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


def handler(event, context):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    p = {k: v[0] for k, v in urllib.parse.parse_qs(raw, keep_blank_values=True).items()}
    cfg = json.loads(SM.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    print("PeriodReturnURL", json.dumps({k: p.get(k) for k in LOG}, ensure_ascii=False))
    if not hmac.compare_digest(p.get("CheckMacValue", "").upper(), cmv(p, cfg["hash_key"], cfg["hash_iv"])):
        print("CheckMacValue INVALID")
        return _text("0|CheckMacValueInvalid", 400)
    if p.get("MerchantID") != cfg["merchant_id"]:
        return _text("0|MerchantIDMismatch", 400)
    print("CMV verified")
    if p.get("SimulatePaid") == "1":
        print("SimulatePaid=1 -> ack only, no bookkeeping")
        return _text("1|OK")

    mtn = p.get("MerchantTradeNo", "")
    email, route = p.get("CustomField1", "").strip().lower(), p.get("CustomField2", "").strip()
    row = TABLE.get_item(Key={"email": email, "route": route}).get("Item") if email and route else None
    if not row:  # fallback: locate by trade-no
        hits = TABLE.scan(FilterExpression=Attr("merchant_trade_no").eq(mtn)).get("Items", [])
        row = hits[0] if hits else None
    if not row:
        print("no row for", mtn)
        return _text("1|OK")
    key = {"email": row["email"], "route": row["route"]}
    now = datetime.now(timezone.utc)
    ts = now.strftime(TS)

    if p.get("RtnCode") == "1":
        done = int(p.get("TotalSuccessTimes") or 0)
        if done and done <= int(row.get("total_success_times", 0)):
            print("charge", done, "already recorded -> idempotent ack")
            return _text("1|OK")
        ptype = p.get("PeriodType") or row.get("period_type") or "M"
        freq = int(p.get("Frequency") or 1)
        cur = row.get("current_period_end")
        base = max(now, datetime.strptime(cur, TS).replace(tzinfo=timezone.utc)) if cur else now
        end = add_period(base, ptype, freq)
        last = done and done >= int(p.get("ExecTimes") or 10**9)
        status = "cancelled" if (last or row.get("subscription_status") == "cancelled") else "active"
        TABLE.update_item(
            Key=key,
            UpdateExpression=("SET subscription_status = :s, current_period_end = :e, current_period_end_date = :ed, "
                              "last_charged_at = :u, total_success_times = :n, failed_attempts = :z, updated_at = :u"),
            ExpressionAttributeValues={":s": status, ":e": end.strftime(TS),
                                       ":ed": (end + timedelta(hours=8)).strftime("%Y-%m-%d"),
                                       ":u": ts, ":n": done or int(row.get("total_success_times", 1)) + 1, ":z": 0})
        print("renewal OK ->", status, "until", end.strftime(TS), "TotalSuccessTimes", done,
              "(final scheduled charge)" if last else "")
    else:
        fails = int(row.get("failed_attempts", 0)) + 1
        status = "expired" if fails >= 6 else row.get("subscription_status", "active")
        TABLE.update_item(Key=key, UpdateExpression="SET failed_attempts = :f, subscription_status = :s, updated_at = :u",
                          ExpressionAttributeValues={":f": fails, ":s": status, ":u": ts})
        print("renewal FAILED attempt", fails, "->", status)
    return _text("1|OK")
