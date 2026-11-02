# flight-ecpay-result (M2) — ANY /ecpay-result  (ECPay OrderResultURL, a browser POST)
# UX-only: turns ECPay's POST into a 302 back to the SPA (a static host 405s on POST).
# Never activates anything — ReturnURL (flight-ecpay-return) is the source of truth.
import base64, os, urllib.parse


def handler(event, context):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    rc = urllib.parse.parse_qs(raw).get("RtnCode", [""])[0]
    state = "failed" if rc and rc != "1" else "success"
    site = os.environ["SITE_URL"].strip().rstrip("/")
    print("OrderResultURL RtnCode=%r -> %s" % (rc, state))
    return {"statusCode": 302, "headers": {"Location": f"{site}/app?purchase={state}"}, "body": ""}
