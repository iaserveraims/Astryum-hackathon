#!/usr/bin/env bash
# Golden Path E2E — exercises V1 backend end-to-end against a real wallet.
#
# Usage (split in two phases — wallet sign happens between phase 1 and phase 2):
#
#   # Phase 1: read + simulate + prepare intent
#   WALLET=0x... \
#   SESSION=session-1 \
#   PROTOCOL=kinetic \
#   ACTION=repay \
#   PARAMS_JSON='{"cToken":"0x...","amount":"100000000000000000000","decimals":18,"priceUSD":1,"collateralUSD":1000,"debtUSD":500,"collateralFactor":0.7,"flrPriceUSD":0.02}' \
#   bash backend/scripts/golden-path.sh
#
#   # → Prints intent.txData → user signs in MetaMask/Bifrost
#   # → Re-run with INTENT_ID + SIGNED_TX env vars to continue:
#
#   # Phase 2: submit + track + verify refresh
#   INTENT_ID=clxxxxxx \
#   SIGNED_TX=0x...rawhex... \
#   WALLET=0x... \
#   bash backend/scripts/golden-path.sh
#
# Requires: curl, jq

set -euo pipefail

API="${API:-http://localhost:3001}"
WALLET="${WALLET:-}"
PROTOCOL="${PROTOCOL:-kinetic}"
ACTION="${ACTION:-repay}"
SESSION="${SESSION:-session-$(date +%s)}"
INTENT_ID="${INTENT_ID:-}"
SIGNED_TX="${SIGNED_TX:-}"
PARAMS_JSON="${PARAMS_JSON:-{}}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_cya=$'\033[36m'; c_off=$'\033[0m'
fail() { echo "${c_red}❌ FAIL: $*${c_off}"; exit 1; }
pass() { echo "${c_grn}✅ $*${c_off}"; }
info() { echo "${c_cya}ℹ️  $*${c_off}"; }
warn() { echo "${c_yel}⚠️  $*${c_off}"; }

require() { command -v "$1" >/dev/null 2>&1 || fail "missing dep: $1"; }
require curl
require jq

[ -n "$WALLET" ] || fail "WALLET env var required"

# ----------------------------------------------------------------------------
# PHASE 2: post-signature submission
# ----------------------------------------------------------------------------
if [ -n "$INTENT_ID" ] && [ -n "$SIGNED_TX" ]; then
  echo "${c_cya}── Phase 2: submit signed tx ──${c_off}"
  echo

  echo "8️⃣  POST /api/execution/submit"
  R=$(curl -sS -X POST "$API/api/execution/submit" \
      -H 'Content-Type: application/json' \
      -d "$(jq -n --arg id "$INTENT_ID" --arg tx "$SIGNED_TX" '{intentId:$id,signedTx:$tx}')")
  echo "$R" | jq .
  TXHASH=$(echo "$R" | jq -r '.txHash // empty')
  [ -n "$TXHASH" ] || fail "no txHash in response"
  pass "submitted: $TXHASH"
  echo

  echo "9️⃣  POST /api/execution/track (poll until terminal status)"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    R=$(curl -sS -X POST "$API/api/execution/track" \
        -H 'Content-Type: application/json' \
        -d "$(jq -n --arg h "$TXHASH" '{txHash:$h}')")
    STATUS=$(echo "$R" | jq -r '.status // "PENDING"')
    info "  poll $i: status=$STATUS"
    if [ "$STATUS" != "PENDING" ]; then
      echo "$R" | jq .
      [ "$STATUS" = "CONFIRMED" ] && pass "tx CONFIRMED"
      [ "$STATUS" = "FAILED" ] && fail "tx FAILED on chain"
      break
    fi
    sleep 5
  done
  echo

  echo "🔟 GET /api/portfolio/snapshot/latest (verify refresh)"
  curl -sS "$API/api/portfolio/snapshot/latest?address=$WALLET" | jq '{wallet,totalUSD,takenAt}'
  pass "snapshot retrieved"

  exit 0
fi

# ----------------------------------------------------------------------------
# PHASE 1: read + simulate + prepare intent
# ----------------------------------------------------------------------------
echo "${c_cya}── Phase 1: read + simulate + prepare intent ──${c_off}"
echo "  WALLET=$WALLET"
echo "  PROTOCOL=$PROTOCOL  ACTION=$ACTION  SESSION=$SESSION"
echo

echo "1️⃣  GET /health"
R=$(curl -sS "$API/health")
echo "$R" | jq -r '.status // .message // "(no body)"'
pass "backend up"
echo

echo "2️⃣  GET /api/positions/$PROTOCOL/$WALLET"
R=$(curl -sS "$API/api/positions/$PROTOCOL/$WALLET")
ERR=$(echo "$R" | jq -r '.error // empty')
if [ -n "$ERR" ]; then
  warn "  protocol responded with error: $ERR"
  if [ "$ERR" = "protocol_inactive" ]; then
    fail "$PROTOCOL inactive — set its env address (e.g. KINETIC_COMPTROLLER) and restart backend"
  fi
fi
COUNT=$(echo "$R" | jq -r '.positions | length // 0')
info "  $COUNT raw position(s) returned by adapter"
echo

echo "3️⃣  GET /api/portfolio?address=$WALLET"
R=$(curl -sS "$API/api/portfolio?address=$WALLET")
echo "$R" | jq '{totalUSD,collateralUSD,debtUSD,netWorthUSD,takenAt,positionsCount:(.positions|length)}'
TOTAL=$(echo "$R" | jq -r '.totalUSD // 0')
pass "portfolio totalUSD=$TOTAL"
echo

echo "4️⃣  GET /api/risk/portfolio?address=$WALLET"
R=$(curl -sS "$API/api/risk/portfolio?address=$WALLET")
echo "$R" | jq '{riskScore,riskLevel,healthFactor,ltv,warnings}'
pass "risk evaluated"
echo

echo "5️⃣  POST /api/simulate/$ACTION"
R=$(curl -sS -X POST "$API/api/simulate/$ACTION" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n --arg w "$WALLET" --arg p "$PROTOCOL" --argjson params "$PARAMS_JSON" \
        '{walletAddress:$w,protocolId:$p,params:$params}')")
echo "$R" | jq '{id,success,newHF,newLTV,gasEstimateUSD,netUSDImpact,warnings}'
SIM_ID=$(echo "$R" | jq -r '.id // empty')
[ -n "$SIM_ID" ] || fail "simulation did not return id"
pass "simulation persisted: $SIM_ID"
echo

echo "6️⃣  POST /api/intents (with simulationResultId)"
R=$(curl -sS -X POST "$API/api/intents" \
    -H 'Content-Type: application/json' \
    -d "$(jq -n \
        --arg w "$WALLET" \
        --arg s "$SESSION" \
        --arg p "$PROTOCOL" \
        --arg a "$ACTION" \
        --arg sid "$SIM_ID" \
        --argjson params "$PARAMS_JSON" \
        '{walletAddress:$w,sessionId:$s,protocolId:$p,actionKind:$a,simulationResultId:$sid,params:$params}')")
echo "$R" | jq '{id,status,txData:.txData,expiresAt}'
INTENT=$(echo "$R" | jq -r '.id // empty')
TXDATA=$(echo "$R" | jq -c '.txData // empty')
[ -n "$INTENT" ] || fail "intent not created"
pass "intent created: $INTENT (status=proposed)"
echo

echo "7️⃣  USER ACTION REQUIRED:"
echo
echo "   Sign the following txData with your wallet (MetaMask/Bifrost):"
echo "   $TXDATA"
echo
echo "   Then re-run with:"
echo "     INTENT_ID=$INTENT \\"
echo "     SIGNED_TX=0xRAW_HEX_FROM_WALLET \\"
echo "     WALLET=$WALLET \\"
echo "     bash backend/scripts/golden-path.sh"
echo
exit 0
