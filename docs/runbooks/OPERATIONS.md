# SENTINEL — Operations Runbook

## Health Monitor Architecture

Sentinel runs a lightweight HTTP health endpoint alongside the main agent.

### Health Endpoint: GET /health

Returns JSON with all system metrics:

```json
{
  "status": "ok",
  "timestamp": "2026-03-10T12:00:00Z",
  "components": {
    "heartbeat": { "status": "ok", "last_cycle": "2s ago", "cycles_today": 1440 },
    "chain_monitor": { "status": "ok", "source": "helius_webhook", "last_event": "14s ago" },
    "neo4j": { "status": "ok", "nodes": 1247, "edges": 3891 },
    "ollama": { "status": "ok", "model": "obliteratus", "loaded": true },
    "twitter": { "status": "ok", "posts_today": 4, "rate_limit_remaining": 42 },
    "alerts": { "status": "ok", "pending_approvals": 0 },
    "memory": { "usage_mb": 847, "context_window_pct": 42 }
  },
  "investigations": { "completed_today": 14, "queued": 3 },
  "errors": { "last_hour": 0, "last_24h": 3 }
}
```

### Watchdog Process (systemd timer)

Runs independently of the main agent. Checks /health every 5 minutes.

**Logic:**
1. Ping http://localhost:3000/health
2. If response.status != "ok" -> increment failure counter
3. If 3 consecutive failures -> restart Sentinel + send P0 Telegram alert
4. If response.status == "ok" -> reset failure counter

**Watchdog script:** `/usr/local/bin/sentinel-healthcheck`
```bash
#!/bin/bash
HEALTH_URL="http://localhost:3000/health"
FAILURE_FILE="/tmp/sentinel-watchdog-failures"
MAX_FAILURES=3

# Get current failure count
FAILURES=$(cat "$FAILURE_FILE" 2>/dev/null || echo 0)

# Check health
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$HEALTH_URL")

if [ "$HTTP_CODE" = "200" ]; then
    echo 0 > "$FAILURE_FILE"
    exit 0
fi

# Health check failed
FAILURES=$((FAILURES + 1))
echo "$FAILURES" > "$FAILURE_FILE"

if [ "$FAILURES" -ge "$MAX_FAILURES" ]; then
    echo "[WATCHDOG] $MAX_FAILURES consecutive failures — restarting Sentinel"
    systemctl restart openclaw-sentinel
    echo 0 > "$FAILURE_FILE"
    
    # Send Telegram alert
    TELEGRAM_BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN /opt/sentinel/.env | cut -d= -f2)
    TELEGRAM_CHAT_ID=$(grep TELEGRAM_CHAT_ID /opt/sentinel/.env | cut -d= -f2)
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        -d "text=🚨 [P0] Sentinel heartbeat stalled — auto-restarted after ${MAX_FAILURES} failures" \
        -d "parse_mode=HTML"
fi
```

### RPC Fallback Rotation

Built into the chain monitor. Automatic failover:

| Priority | Provider | Latency | Notes |
|----------|----------|---------|-------|
| 1 | Helius Webhooks | Real-time | Primary — lowest latency |
| 2 | Helius RPC | ~5s polling | Fallback if webhooks fail |
| 3 | QuickNode | ~5s polling | Fallback if Helius is down |
| 4 | Public Solana RPC | ~5s polling | Last resort, rate limited |

Each failover triggers a P1 Telegram alert.

### Daily Self-Diagnostic

Automatically sent to Telegram at midnight EST:
- Uptime and restart count
- Investigation stats (completed, queued, flagged)
- Post stats (published, rejected)
- Neo4j graph size
- Model status
- Error count
- Memory and context window usage

### Alert Escalation Matrix

| Condition | Level | Action |
|-----------|-------|--------|
| Heartbeat stalled >5min | P0 | Watchdog auto-restart + Telegram |
| All RPCs failed | P0 | Telegram immediate |
| Neo4j down >2min | P0 | Telegram immediate |
| Confirmed rug detected | P0 | Telegram + queue post |
| RPC degraded to fallback | P1 | Telegram |
| Context window >80% | P1 | Force compaction + Telegram |
| Memory >2GB | P1 | Telegram |
| Score >85 token found | P1 | Telegram + queue investigation |
| Queue depth >30 | P2 | Daily digest |
| No posts all day | P2 | Daily digest |

### Common Issues and Fixes

**Ollama model not loading:**
```bash
ollama list                    # Check what's installed
ollama pull obliteratus        # Re-pull model
systemctl restart ollama       # Restart Ollama service
```

**Neo4j connection refused:**
```bash
systemctl status neo4j         # Check if running
neo4j console                  # Run in foreground to see errors
```

**Context window bloat:**
The agent will auto-compact at 85% usage. If it reaches 90%, it performs a graceful restart. If you see frequent context issues, check that investigations are properly flushing to Neo4j instead of keeping data in context.

**Twitter rate limited:**
Sentinel self-limits to 6 posts/day. If Twitter itself rate-limits the account, the agent will back off automatically and retry after the cooldown period. Check `engine/alerts` Telegram for rate limit warnings.
