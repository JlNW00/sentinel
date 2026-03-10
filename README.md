# SENTINEL

**Autonomous Solana forensics AI agent — on-chain rug detection, wallet clustering, and real-time threat intelligence.**

Built on [OpenClaw](https://github.com/openclaw-ai/openclaw). No Docker required.

---

## What Is Sentinel?

Sentinel is an autonomous AI agent that monitors the Solana blockchain for rug pulls, coordinated manipulation, and fraudulent token launches. It investigates suspicious activity, publishes findings on Twitter, and builds a persistent knowledge graph of scammer wallet networks.

**It is NOT:** a trading bot, an alpha caller, or financial advice.
**It IS:** an investigative process that happens to communicate via Twitter.

---

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           SENTINEL AGENT                 │
                    │         (OpenClaw Runtime)                │
                    │                                          │
                    │  ┌──────────┐  ┌──────────────────────┐ │
                    │  │ SOUL.md  │  │    HEARTBEAT.md       │ │
                    │  │(persona) │  │  (60s autonomous loop)│ │
                    │  └──────────┘  └──────────────────────┘ │
                    └──────────┬───────────────┬───────────────┘
                               │               │
              ┌────────────────┼───────────────┼────────────────┐
              │                │               │                │
     ┌────────▼──────┐ ┌──────▼─────┐ ┌───────▼──────┐ ┌──────▼──────┐
     │ Chain Monitor │ │  Scoring   │ │  Developer   │ │   Content   │
     │    (Helius)   │ │  Engine    │ │  Profiler    │ │  Strategy   │
     │               │ │ (3-layer)  │ │(GitHub/LI/TW)│ │ (5 types)   │
     └───────┬───────┘ └──────┬─────┘ └──────┬───────┘ └──────┬──────┘
             │                │              │                │
             │         ┌──────▼──────┐       │         ┌──────▼──────┐
             │         │  Neo4j KG   │◄──────┘         │  Twitter    │
             │         │  (Entity    │                  │  (Twikit)   │
             │         │  Resolution)│                  └──────┬──────┘
             │         └─────────────┘                         │
             │                                          ┌──────▼──────┐
             └─────────────────────────────────────────►│  Telegram   │
                                                        │  (Alerts)   │
                                                        └─────────────┘
     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
     │   Ollama     │  │ Watchdog    │  │ Re-Invest   │
     │ (Obliteratus)│  │ (systemd)   │  │ (6hr cron)  │
     └─────────────┘  └─────────────┘  └─────────────┘
```

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|--------|
| Runtime | OpenClaw | Agent framework, skill system, LLM orchestration |
| LLM (Primary) | Ollama + Obliteratus | Local, uncensored analysis |
| LLM (Escalation) | Claude API | Complex multi-step investigations |
| Knowledge Graph | Neo4j Community | Wallet clustering, entity resolution |
| Blockchain Data | Helius Webhooks + RPC | Real-time Solana event monitoring |
| Twitter | Twikit/Twscrape | Posting, scraping (no paid API) |
| Alerts | Telegram Bot API | Real-time notifications, approval queue |
| Process Mgmt | systemd | Auto-restart, watchdog timer |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/JlNW00/sentinel.git
cd sentinel

# 2. Run setup (installs everything — no Docker)
chmod +x infra/setup.sh
./infra/setup.sh

# 3. Configure API keys
nano .env  # Fill in your Helius, Twitter, Telegram keys

# 4. Start Sentinel
openclaw gateway start

# 5. Check health
curl http://localhost:3000/health
```

See [Phase 0.5 Playbook](docs/phase05-playbook/COLD-START.md) for the manual operation guide.

---

## Components

### Phase 0: Core Agent
| File | Description |
|------|-------------|
| [`agent/SOUL.md`](agent/SOUL.md) | Personality, voice, confidence-gated language system |
| [`agent/HEARTBEAT.md`](agent/HEARTBEAT.md) | Autonomous loop, scheduling, rate limiting |
| [`infra/setup.sh`](infra/setup.sh) | One-command native install script |
| [`infra/configs/models.yaml`](infra/configs/models.yaml) | Model hierarchy + prompt templates |

### Phase 1: Forensics Engine
| File | Description |
|------|-------------|
| [`engine/chain-monitor/`](engine/chain-monitor/index.js) | Helius webhooks, noise filter, RPC fallback |
| [`engine/scoring/`](engine/scoring/index.js) | 3-layer scoring (vitals, behavioral, metadata) |
| [`engine/profiler/`](engine/profiler/index.js) | GitHub + LinkedIn + Twitter developer profiling |
| [`engine/alerts/`](engine/alerts/index.js) | Telegram P0/P1/P2 alerts + approval queue |

### Phase 2: Intelligence Layer
| File | Description |
|------|-------------|
| [`graph/neo4j-schema/`](graph/neo4j-schema/migration.cypher) | Knowledge graph schema + constraints |
| [`graph/queries/`](graph/queries/investigations.cypher) | 10 investigation query templates |
| [`content/scheduler/`](content/scheduler/index.js) | 5 content types, daily scheduling, jitter |
| [`agent/skills/twitter-integration.js`](agent/skills/twitter-integration.js) | Anti-detection, engagement tracking |
| [`agent/skills/reinvestigation-trigger.js`](agent/skills/reinvestigation-trigger.js) | Slow rug detection, 6hr watchlist |

### Phase 3: Evolution
| File | Description |
|------|-------------|
| [`agent/skills/osint-expansion.js`](agent/skills/osint-expansion.js) | WHOIS, Telegram, Discord, fund tracing stubs |
| [`agent/skills/self-improvement.js`](agent/skills/self-improvement.js) | Outcome tracking, weight adjustment |

### Documentation
| File | Description |
|------|-------------|
| [`docs/runbooks/OPERATIONS.md`](docs/runbooks/OPERATIONS.md) | Health monitor, watchdog, troubleshooting |
| [`docs/phase05-playbook/COLD-START.md`](docs/phase05-playbook/COLD-START.md) | 14-day manual operation guide |

---

## Scoring System

Every token gets a 0-100 risk score across three layers:

| Layer | Weight | Signals |
|-------|--------|--------|
| Token Vitals | 35% | Liquidity lock, LP burn, holder concentration, mint authority, Gini coefficient |
| Behavioral | 35% | Coordinated buys, wash trading, sniper wallets, MEV/sandwich attacks |
| Metadata | 30% | Website quality, social presence, deployer history, code originality, audit status |

Score maps to confidence tiers (from SOUL.md):
- **0-69:** OBSERVATION — "Unusual activity detected"
- **70-84:** RED FLAGS — "Multiple red flags detected"  
- **85-94:** HIGH PROBABILITY — "High probability of fraud"
- **95-100:** CONFIRMED — "Confirmed rug. Receipts attached"

---

## Roadmap

- [x] Phase 0: Core agent (SOUL, HEARTBEAT, setup, model config)
- [x] Phase 1: Forensics engine (chain monitor, scoring, profiler, alerts)
- [x] Phase 2: Intelligence layer (Neo4j, content, Twitter, health monitor)
- [ ] Phase 3: OSINT expansion (WHOIS, Telegram, Discord, fund tracing)
- [ ] Phase 3: Self-improvement loop (outcome tracking, weight optimization)
- [ ] Community intel network (crowdsourced tips)
- [ ] Multi-chain expansion (Base, Ethereum)

---

## License

MIT — See [LICENSE](LICENSE)

---

*Sentinel watches the chain so you don't have to.*
