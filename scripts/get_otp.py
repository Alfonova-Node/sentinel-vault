#!/usr/bin/env python3
"""Poll IMAP Gmail, ambil kode OTP terbaru dari Terminal 3."""
import imaplib, email, os, re, sys, time

from_email = os.environ.get("IMAP_HOST")
user = os.environ.get("IMAP_USER")
pwd = os.environ.get("IMAP_PASS")
# OTP lama yang harus di-skip (biar gak kebaca kode basi)
seen_file = os.environ.get("SEEN_OTP_FILE", ".state/seen_otp.txt")
try:
    seen = set(open(seen_file).read().split())
except Exception:
    seen = set()

deadline = time.time() + int(sys.argv[1]) if len(sys.argv) > 1 else time.time() + 120
latest = None

while time.time() < deadline:
    try:
        m = imaplib.IMAP4_SSL(from_email)
        m.login(user, pwd)
        m.select("INBOX")
        _, data = m.search(None, '(FROM "terminal3" UNSEEN)')
        ids = data[0].split()
        for mid in reversed(ids):  # terbaru dulu
            _, d = m.fetch(mid, "(RFC822)")
            msg = email.message_from_bytes(d[0][1])
            subj = str(msg.get("Subject", ""))
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        body += part.get_payload(decode=True).decode("utf-8", "ignore")
            else:
                body = msg.get_payload(decode=True).decode("utf-8", "ignore")
            hits = re.findall(r"[Cc]ode[^0-9]{0,40}(\d{6})", body)
            if hits:
                code = hits[0]
                if code not in seen:
                    print(code)
                    seen.add(code)
                    open(seen_file, "w").write("\n".join(seen))
                    m.logout()
                    sys.exit(0)
        m.logout()
    except Exception as e:
        print(f"[poll err: {e}]", file=sys.stderr)
    time.sleep(6)

print("TIMEOUT", file=sys.stderr)
sys.exit(1)
