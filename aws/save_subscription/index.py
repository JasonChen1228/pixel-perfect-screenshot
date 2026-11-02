# flight-save-subscription (M2) — POST /subscribe
# New/unpaid/expired plan -> row becomes pending_payment + returns an ECPay
# 信用卡定期定額 auto-submit form (text/html). Active or cancelled-in-grace plan
# -> in-place target-price update (application/json), no re-payment.
# Spec source: ECPay AIO 定期定額 (SNAPSHOT 2026-03, guides/01-payment-aio.md).
import base64, hashlib, html, json, os, re, urllib.parse
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import boto3

TABLE = boto3.resource("dynamodb").Table("subscriptions")
SM = boto3.client("secretsmanager")
TS = "%Y-%m-%dT%H:%M:%SZ"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PLANS = {
    "tokyo": ("TPE", "TYO", "台北-東京"),
    "seoul": ("TPE", "SEL", "台北-首爾"),
    "london": ("TPE", "LON", "台北-倫敦"),
}


def _enc(s):
    e = urllib.parse.quote_plus(str(s)).replace("~", "%7E").lower()
    for o, n in (("%2d", "-"), ("%5f", "_"), ("%2e", "."), ("%21", "!"), ("%2a", "*"), ("%28", "("), ("%29", ")")):
        e = e.replace(o, n)
    return e


def cmv(p, key, iv):
    items = {k: v for k, v in p.items() if k != "CheckMacValue"}  # keep "" values
    body = "&".join(f"{k}={items[k]}" for k in sorted(items, key=str.lower))
    return hashlib.sha256(_enc(f"HashKey={key}&{body}&HashIV={iv}").encode()).hexdigest().upper()


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
    email = str(b.get("email", "")).strip().lower()
    plan = str(b.get("plan_name", "")).strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 50:  # CustomField1 is String(50)
        return _json(400, {"error": "a valid email (max 50 chars) is required"})
    if plan not in PLANS:
        return _json(400, {"error": "plan_name must be one of: " + ", ".join(PLANS)})
    try:
        target = int(b.get("target_price"))
        assert 0 < target <= 1_000_000
    except Exception:
        return _json(400, {"error": "target_price must be a positive TWD amount"})

    origin, dest, label = PLANS[plan]
    route = f"{origin}-{dest}"
    key = {"email": email, "route": route}
    now = datetime.now(timezone.utc)
    ts = now.strftime(TS)
    row = TABLE.get_item(Key=key).get("Item") or {}
    st = row.get("subscription_status")

    # Paid (or cancelled but still paid-through): update the target in place.
    if st == "active" or (st == "cancelled" and str(row.get("current_period_end", "")) >= ts):
        item = TABLE.update_item(
            Key=key, UpdateExpression="SET target_price = :t, updated_at = :u",
            ExpressionAttributeValues={":t": Decimal(target), ":u": ts}, ReturnValues="ALL_NEW")["Attributes"]
        return _json(200, {"ok": True, **item})

    # Otherwise start (or restart) an ECPay recurring checkout.
    cfg = json.loads(SM.get_secret_value(SecretId="flight/ecpay")["SecretString"])
    amount = str(int(cfg["amount"]))
    mtn = "FN" + now.strftime("%y%m%d%H%M%S") + os.urandom(3).hex().upper()  # 20 chars
    ptype = os.environ.get("PERIOD_TYPE", "M").strip()
    exec_times = os.environ.get("EXEC_TIMES", "999").strip()
    TABLE.update_item(
        Key=key,
        UpdateExpression=("SET plan_name = :p, origin = :o, destination = :d, target_price = :t, currency = :c, "
                          "subscription_status = :s, merchant_trade_no = :m, period_type = :pt, "
                          "created_at = if_not_exists(created_at, :u), updated_at = :u"),
        ExpressionAttributeValues={":p": plan, ":o": origin, ":d": dest, ":t": Decimal(target), ":c": "TWD",
                                   ":s": "pending_payment", ":m": mtn, ":pt": ptype, ":u": ts})

    api = (os.environ.get("API_BASE") or f"https://{event['requestContext']['domainName']}").strip().rstrip("/")
    p = {
        "MerchantID": cfg["merchant_id"], "MerchantTradeNo": mtn,
        "MerchantTradeDate": (now + timedelta(hours=8)).strftime("%Y/%m/%d %H:%M:%S"),  # UTC+8
        "PaymentType": "aio", "TotalAmount": amount, "TradeDesc": "Flight Price Notifier monthly plan",
        "ItemName": f"Flight Price Notifier {label} 月訂閱", "ChoosePayment": "Credit", "EncryptType": "1",
        "ReturnURL": f"{api}/ecpay-return", "OrderResultURL": f"{api}/ecpay-result",
        "PeriodAmount": amount, "PeriodType": ptype, "Frequency": "1", "ExecTimes": exec_times,
        "PeriodReturnURL": f"{api}/ecpay-period", "CustomField1": email, "CustomField2": route,
    }
    p["CheckMacValue"] = cmv(p, cfg["hash_key"], cfg["hash_iv"])
    host = "payment.ecpay.com.tw" if cfg.get("env") == "prod" else "payment-stage.ecpay.com.tw"
    fields = "".join(f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">' for k, v in p.items())
    page = ('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>前往綠界付款</title></head>'
            '<body style="font-family:sans-serif;background:#0b0b10;color:#eee;padding:2rem">'
            '<p>正在前往綠界付款頁… Redirecting to ECPay…</p>'
            f'<form action="https://{host}/Cashier/AioCheckOut/V5" method="post">{fields}'
            '<noscript><button type="submit">前往付款</button></noscript></form>'
            '<script>document.forms[0].submit()</script></body></html>')
    print("checkout", json.dumps({"email": email, "route": route, "mtn": mtn, "amount": amount, "period": ptype}))
    return {"statusCode": 200, "headers": {"Content-Type": "text/html; charset=utf-8"}, "body": page}
