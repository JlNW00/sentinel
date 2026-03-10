# SENTINEL — Phase 0.5: Cold Start Playbook

> For the first 2 weeks, YOU are Sentinel.
> This playbook guides you through manually building the account
> before handing control to the autonomous agent.

---

## Why Manual First?

1. **AI-generated accounts get flagged fast.** A brand new Twitter account posting 6 forensic threads on day 1 screams bot.
2. **You need to calibrate the voice.** See what resonates with CT before locking in the content strategy.
3. **Build initial followers organically.** 50-100 real followers >> 10,000 bots.
4. **Test the investigation pipeline.** Make sure scoring + alerts work before auto-posting.

---

## Pre-Launch Checklist

- [ ] Twitter account created (@SentinelSOL or similar)
- [ ] Profile photo: AI-generated avatar (cyberpunk/detective aesthetic)
- [ ] Bio: "Autonomous Solana forensics. I follow the money. Not financial advice."
- [ ] Pinned tweet: introductory thread explaining what Sentinel does
- [ ] Telegram bot created (@BotFather) for alerts
- [ ] Sentinel agent running locally (HEARTBEAT in human-in-loop mode)
- [ ] Neo4j populated with initial wallet data from first investigation

---

## Week 1: Establish Presence (Days 1-7)

### Daily Routine
| Time | Action | Duration |
|------|--------|----------|
| 9 AM | Check Sentinel alerts from overnight | 10 min |
| 9:30 AM | Post morning content (educational or observation) | 15 min |
| 10 AM | Engage with 10 Solana CT accounts (genuine replies) | 30 min |
| 12 PM | Follow 25 relevant accounts | 10 min |
| 2 PM | Post investigation if Sentinel flagged something | 30 min |
| 4 PM | Engage with 10 more accounts | 20 min |
| 6 PM | Follow 25 more accounts | 10 min |
| 8 PM | Post evening content (recap or educational) | 15 min |
| 10 PM | Review Sentinel's queued posts, approve/reject | 10 min |

### Day-by-Day Content Calendar

**Day 1:** Introduction thread — who is Sentinel, what it does, why it exists
**Day 2:** Educational — "How to check if liquidity is locked in 30 seconds"
**Day 3:** First investigation — pick a clearly suspicious token, do manual analysis + Sentinel scoring
**Day 4:** Wallet deep dive — trace a known rugger's wallet history
**Day 5:** Educational — "Red flags in holder distribution explained"
**Day 6:** Investigation — let Sentinel flag one, you write the thread
**Day 7:** Week 1 recap — stats, learnings, what worked

### Engagement Targets (Week 1)
- Follow: 50 accounts/day (Solana CT, security researchers, DeFi analysts)
- Reply: 20 threads/day (genuine alpha, not "nice post!" spam)
- Quote-tweet: 5/day (add analysis to existing CT conversations)
- Target: 100+ followers by end of week 1

### Target Accounts to Engage With
Build a list of 50-100 accounts in these categories:
- **Solana CT influencers** (people who discuss new launches)
- **Security researchers** (audit firms, white hats)
- **Other forensics accounts** (anyone doing similar work)
- **DeFi analysts** (people analyzing protocols)
- **Victims** (people who got rugged — they'll appreciate your work)

---

## Week 2: Build Credibility (Days 8-14)

### Shift to Semi-Auto
- Start approving more Sentinel-generated content via Telegram
- Focus your time on engagement and relationship building
- Let Sentinel handle routine investigations; you curate output

### Day-by-Day

**Day 8:** Investigation thread (Sentinel-generated, you approve)
**Day 9:** Educational + engagement poll
**Day 10:** Wallet of the Day (Sentinel picks, you verify and approve)
**Day 11:** Pattern report — "This week in Solana rugs"
**Day 12:** Investigation (fully Sentinel-generated, minimal edits)
**Day 13:** Educational + CT engagement
**Day 14:** Transition assessment — review metrics and decide next step

### Metrics to Track
| Metric | Week 1 Target | Week 2 Target |
|--------|---------------|---------------|
| Followers | 100 | 300 |
| Avg likes per post | 5 | 15 |
| Avg RTs per post | 2 | 8 |
| Reply engagement rate | 3% | 5% |
| Investigation threads posted | 3 | 5 |
| False positives | <2 | <1 |
| Confirmed rugs called | 1+ | 3+ |

---

## Transition Criteria: Manual -> Semi-Auto -> Full Auto

### Manual -> Semi-Auto (End of Week 1)
All of these must be true:
- [x] 50+ followers
- [x] 3+ investigation threads posted without backlash
- [x] Alert system working (Telegram notifications arriving)
- [x] Scoring engine producing reasonable scores (manual verification)
- [x] Sentinel-generated content passes your quality bar >80% of the time

### Semi-Auto -> Full Auto (End of Week 2)
All of these must be true:
- [ ] 200+ followers
- [ ] <5% rejection rate on Sentinel-generated posts
- [ ] Zero false accusations in published content
- [ ] Engagement rate >3% on investigation threads
- [ ] At least 1 confirmed rug correctly called before it happened
- [ ] 14+ days of continuous operation without critical failures
- [ ] You're comfortable with the voice and accuracy

### After Full Auto
- Keep human-in-loop for P0 posts (confirmed rugs) for the first month
- Monitor daily diagnostic via Telegram
- Review weekly metrics report
- Intervene only for edge cases or unusual situations

---

## Emergency Procedures

**Sentinel tweets something wrong:**
1. Delete the tweet immediately (manual login)
2. Post correction in Sentinel's voice
3. Switch back to human-in-loop mode
4. Review what went wrong in the scoring/generation pipeline

**Account suspended:**
1. Appeal immediately
2. While waiting, continue running Sentinel in silent mode (collecting data, not posting)
3. Consider backup account (have one ready but dormant)

**Negative community backlash:**
1. Don't delete valid investigation threads (this destroys credibility)
2. If wrong, post transparent correction with data
3. If right but controversial, let the evidence speak and don't engage in drama
4. If being brigaded, mute/block and continue operations
