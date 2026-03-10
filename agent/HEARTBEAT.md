# SENTINEL — HEARTBEAT DEFINITION

> The autonomous loop that keeps Sentinel alive.
> Every 60 seconds, Sentinel wakes up, looks at the chain, and decides what to do.

---

## LOOP OVERVIEW

```
EVERY 60 SECONDS:
  1. POLL chain monitor for new events
  2. CHECK investigation queue
  3. IF investigation pending → run forensic analysis
  4. IF idle → check content schedule
  5. IF content due → generate and queue post
  6. CHECK health metrics
  7. LOG cycle metrics
  8. SLEEP until next tick
```

---

## PHASE 0.5: HUMAN-IN-THE-LOOP MODE

For the first 2 weeks of operation, Sentinel runs in supervised mode:

### How It Works
- Sentinel generates content and investigation reports normally
- Instead of posting directly to Twitter, posts go to a **Telegram approval queue**
- Operator receives each post via Telegram with two buttons: APPROVE / REJECT
- APPROVED posts go live on Twitter immediately
- REJECTED posts get logged with reason (operator types why) for learning

### Config Toggle
```yaml
# In .env or agent config
HUMAN_IN_LOOP: true          # Set to false after Phase 0.5
APPROVAL_TIMEOUT_MINUTES: 60  # Auto-skip if no response (don't post)
APPROVAL_CHANNEL: telegram    # Where approval requests go
```

### Transition Criteria (When to Disable)
- 50+ posts approved with <5% rejection rate
- Zero false accusations in published content
- Operator comfortable with tone and accuracy
- At least 14 days of supervised operation

---

## CHAIN MONITOR POLLING

### What Gets Polled
- Helius webhook queue: new token launches (createToken events)
- Helius webhook queue: new liquidity additions (addLiquidity events)  
- Helius webhook queue: large liquidity removals (removeLiquidity > $5K)
- Re-investigation watchlist: tokens flagged in previous cycles

### Noise Filter
Skip events matching ANY of these:
- Token liquidity < $10,000 (too small to matter)
- Token on whitelist (SOL, USDC, USDT, BONK, JUP, and other verified tokens)
- Duplicate event (already in investigation queue)
- Rate limit: max 10 new investigations per hour (prevent queue flooding)

### Fallback Chain
If primary data source fails:
```
1. Helius webhooks (primary) — real-time, lowest latency
2. Helius RPC polling (fallback 1) — 5-second intervals
3. QuickNode RPC (fallback 2) — if Helius is fully down
4. Public Solana RPC (fallback 3) — last resort, rate limited
```

Each fallback triggers a P1 health alert via Telegram.

---

## INVESTIGATION QUEUE

### Queue Structure
```
Priority Queue (max size: 50)
├── P0: Active rug in progress (process immediately)
├── P1: High-risk new launch (score >85 from initial scan)
├── P2: Re-investigation trigger fired (previously flagged token changed)
├── P3: Medium-risk new launch (score 70-84)
└── P4: Community tip received (unverified, needs initial scan)
```

### Processing Rules
- Process ONE investigation at a time (sequential, not parallel — OpenClaw limitation)
- P0 interrupts any in-progress P3/P4 investigation
- Maximum investigation time: 5 minutes per token (prevents context window bloat)
- If queue exceeds 50 items, drop lowest-priority items and log warning

### Investigation Flow
```
FOR each queued token:
  1. RUN Layer 1 scoring (token vitals) → ~30 seconds
  2. RUN Layer 2 scoring (behavioral analysis) → ~60 seconds  
  3. RUN Layer 3 scoring (metadata forensics) → ~60 seconds
  4. RUN developer/social profiler → ~90 seconds
  5. QUERY Neo4j for deployer wallet history
  6. CALCULATE composite risk score (0-100)
  7. MAP to confidence tier (Observation/Red Flag/High Prob/Confirmed)
  8. IF score >= 70 → generate content using appropriate template
  9. IF human-in-loop → send to Telegram approval queue
  10. IF auto-mode → queue for scheduled posting
  11. UPDATE Neo4j knowledge graph with findings
  12. LOG investigation results
```

---

## CONTENT SCHEDULING

### Daily Schedule (6 posts max)
```
SLOT 1:  09:00-11:00 EST (±15min jitter) — Investigation or Wallet of the Day
SLOT 2:  11:30-13:00 EST (±15min jitter) — Educational content or Pattern Report
SLOT 3:  14:00-16:00 EST (±15min jitter) — Investigation (if available) or Engagement
SLOT 4:  16:30-18:00 EST (±15min jitter) — Filler content or Community response
SLOT 5:  20:00-22:00 EST (±15min jitter) — Investigation or Market observation
SLOT 6:  22:30-00:00 EST (±15min jitter) — Recap or Educational (optional, skip if nothing)
```

### Jitter System
- Each post time gets randomized ±15 minutes from slot center
- Never post on exact hour or half-hour marks (bot detection signal)
- Minimum gap between posts: 2 hours (enforced hard limit)
- If an urgent P0 investigation drops, it can break schedule (but still respects 30-min minimum gap)

### Content Priority
When a slot opens and multiple content items are queued:
```
1. Active rug post-mortem (always takes priority)
2. High-confidence investigation thread
3. Scheduled content type for this slot
4. Community engagement response
5. Skip slot if nothing quality is available (better to skip than post garbage)
```

### Rate Limiting
```yaml
DAILY_POST_LIMIT: 6
HOURLY_POST_LIMIT: 2
MIN_GAP_MINUTES: 120        # 2 hours between regular posts
URGENT_MIN_GAP_MINUTES: 30  # 30 min minimum even for P0
REPLY_LIMIT_PER_ACCOUNT: 2  # Max replies to same account per day
FOLLOW_LIMIT_DAILY: 50      # Anti-detection: don't follow too fast
```

---

## HEALTH METRICS

### Monitored Every Cycle
```
- heartbeat_timestamp: last successful cycle completion
- chain_monitor_status: connected | degraded | down
- chain_monitor_source: helius_webhook | helius_rpc | quicknode | public
- investigation_queue_depth: current items in queue
- neo4j_connected: true | false
- ollama_model_loaded: true | false
- ollama_model_name: which model is active
- twitter_rate_limit_remaining: API calls left in window
- memory_usage_mb: current agent memory consumption
- context_window_usage_pct: how full the context window is
- posts_today: number of posts made today
- last_post_timestamp: when the last post went out
- errors_last_hour: count of errors in rolling window
```

### Alert Thresholds
```
P0 ALERT (immediate Telegram notification):
  - heartbeat stalled > 5 minutes
  - chain_monitor_status == down (all fallbacks failed)
  - neo4j_connected == false for > 2 minutes
  - errors_last_hour > 20

P1 ALERT (urgent Telegram notification):
  - chain_monitor degraded to fallback RPC
  - context_window_usage_pct > 80%
  - memory_usage_mb > 2048
  - ollama_model_loaded == false

P2 ALERT (info, daily digest):
  - investigation_queue_depth > 30
  - twitter_rate_limit_remaining < 10
  - posts_today == 0 (nothing posted all day)
```

### Daily Self-Diagnostic
Every day at midnight EST, Sentinel sends a Telegram summary:
```
SENTINEL DAILY DIAGNOSTIC — [DATE]
━━━━━━━━━━━━━━━━━━━━━━━━━
Uptime: 23h 58m (2 restarts)
Investigations: 14 completed, 3 queued
Posts: 5 published, 1 rejected (human review)
Tokens flagged: 8 (2 confirmed rugs, 6 monitoring)
Neo4j nodes: 1,247 wallets, 89 tokens, 12 clusters
Model: obliteratus-7b (local)
Chain source: helius_webhook (primary)
Errors: 3 (all recovered)
Memory: 847MB / 4096MB
Context: 42% utilized
━━━━━━━━━━━━━━━━━━━━━━━━━
STATUS: OPERATIONAL
```

---

## WATCHDOG PROCESS

Separate from the main agent, a lightweight watchdog runs as a systemd timer:

```
EVERY 5 MINUTES:
  1. HTTP GET /health endpoint
  2. IF response.status != "ok":
     - INCREMENT failure_counter
  3. IF failure_counter >= 3:
     - SEND P0 Telegram alert: "Sentinel heartbeat stalled — restarting"
     - RUN: systemctl restart openclaw-sentinel
     - RESET failure_counter
  4. IF response.status == "ok":
     - RESET failure_counter
```

### Watchdog Config
```yaml
WATCHDOG_INTERVAL_SECONDS: 300   # Check every 5 minutes
WATCHDOG_FAILURE_THRESHOLD: 3    # 3 consecutive failures = restart
WATCHDOG_HEALTH_URL: http://localhost:3000/health
WATCHDOG_TELEGRAM_ON_RESTART: true
```

---

## CONTEXT WINDOW MANAGEMENT

OpenClaw agents accumulate context over time. This is the biggest operational risk.

### Prevention
- Each investigation is self-contained: load data → analyze → output → flush
- Investigation results are persisted to Neo4j, NOT kept in context
- Content templates are loaded fresh each time, not cached in memory
- Conversation history is compacted every 100 cycles (keep summaries, drop raw data)

### Emergency Measures
If context_window_usage_pct > 85%:
1. Force compaction of conversation history
2. Drop all P4 (community tip) investigations from queue
3. Send P1 alert to operator
4. If still > 90% after compaction: graceful restart (save state → restart → reload state)

### Memory Architecture
```
PERSISTENT (Neo4j — survives restarts):
  - All wallet data and clusters
  - Investigation results and scores
  - Token metadata and risk assessments
  - Deployer history and connections

PERSISTENT (File System — survives restarts):
  - Configuration and API keys
  - Content templates
  - Self-improvement metrics
  - Investigation queue (serialized)

EPHEMERAL (Context Window — cleared on restart):
  - Current investigation working data
  - Recent conversation history
  - Temporary analysis results
```

---

## STARTUP SEQUENCE

When Sentinel starts (or restarts):
```
1. LOAD .env configuration
2. VERIFY Ollama is running and model is loaded
3. CONNECT to Neo4j, verify schema
4. CONNECT to Helius webhooks (or fallback to RPC)
5. DESERIALIZE investigation queue from disk (if exists)
6. CHECK last_heartbeat_timestamp — if stale, send "I'm back" alert
7. RESUME normal heartbeat loop
8. SEND Telegram notification: "Sentinel online. Resuming operations."
```
