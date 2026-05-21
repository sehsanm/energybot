#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}
echo "1. health" ; curl -sf "$BASE/health" | grep ok
echo "2. metrics" ; curl -sf "$BASE/metrics" | head -5
echo "3. webhook reject bad secret" ; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/bale/webhook/WRONG" -H "Content-Type: application/json" -d '{}'
echo "4. webhook accept (set BALE_WEBHOOK_SECRET in env first)"
test -n "${BALE_WEBHOOK_SECRET:-}" && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/bale/webhook/$BALE_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{"update_id":999,"message":{"message_id":1,"from":{"id":1},"chat":{"id":1},"text":"hi"}}'
echo "smoke ok"
