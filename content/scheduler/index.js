/**
 * SENTINEL — Content Strategy Engine
 * ====================================
 * Manages what Sentinel posts and when. Five content types with templates,
 * daily scheduling with jitter, and peak-hour weighting.
 * 
 * Covers GAP #5: Content strategy between investigations.
 * 
 * Content Types:
 *   1. Live Investigation Threads — real-time rug dissection
 *   2. Wallet of the Day — deep dive on suspicious cluster
 *   3. Pattern Reports — weekly aggregated stats
 *   4. Educational — how-to tutorials for followers
 *   5. Engagement — polls, questions, CT commentary
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// SCHEDULE CONFIGURATION
// ============================================================
const SCHEDULE = {
  maxPostsPerDay: 6,
  minGapMinutes: 120,
  jitterMinutes: 15,
  
  // Time slots in EST (24hr format)
  slots: [
    { id: 1, startHour: 9,  endHour: 11, preferredType: 'investigation',  weight: 1.2 },
    { id: 2, startHour: 11, endHour: 13, preferredType: 'educational',    weight: 1.0 },
    { id: 3, startHour: 14, endHour: 16, preferredType: 'investigation',  weight: 1.3 },
    { id: 4, startHour: 16, endHour: 18, preferredType: 'engagement',     weight: 0.9 },
    { id: 5, startHour: 20, endHour: 22, preferredType: 'investigation',  weight: 1.4 },
    { id: 6, startHour: 22, endHour: 24, preferredType: 'educational',    weight: 0.7 },
  ],
  
  // Daily content mix target
  dailyMix: {
    investigation: 2,   // Max 2 investigation threads per day
    walletOfDay: 1,      // 1 wallet deep dive
    patternReport: 0.14, // ~1 per week
    educational: 1,
    engagement: 1,
  },
};

// ============================================================
// CONTENT TEMPLATES
// ============================================================
const TEMPLATES = {

  // ---- TYPE 1: Live Investigation Thread ----
  investigation: {
    maxTweets: 8,
    tweetMaxChars: 280,
    structure: [
      { role: 'hook', prompt: 'Opening tweet: what was found, why it matters. Include token name and one shocking stat.' },
      { role: 'evidence_1', prompt: 'First piece of evidence. Include specific wallet address or tx hash.' },
      { role: 'evidence_2', prompt: 'Second piece of evidence. Different angle from first (e.g., holder data if first was deployer data).' },
      { role: 'evidence_3', prompt: 'Third piece of evidence or pattern match with previous rug.' },
      { role: 'deployer_history', prompt: 'Deployer wallet history. Previous tokens, previous rugs, wallet age.' },
      { role: 'connection', prompt: 'Connection to known patterns, clusters, or previous investigations.' },
      { role: 'risk_assessment', prompt: 'Risk score and confidence tier. Use confidence-gated language from SOUL.md.' },
      { role: 'closing', prompt: 'What to watch for next. Link to Solscan or relevant explorer.' },
    ],
    variables: ['tokenName', 'tokenMint', 'riskScore', 'confidenceTier', 'evidence', 'deployerWallet', 'deployerHistory'],
    example: [
      '1/ New token $MOONRUG launched 23 minutes ago. Deployer 7xK9...mR2p has 3 previous rugs in 30 days. Top 5 wallets hold 78% of supply. Thread.',
      '2/ Liquidity: $47K added via Raydium. NOT locked. Deployer retains 100% of LP tokens. Tx: 5nYp...kQ3r',
      '3/ 6 wallets bought within the same block at launch. All funded from the same source wallet 2 hours prior. Coordinated buy pattern.',
      '4/ Deployer wallet 7xK9...mR2p previously deployed $FAKECOIN (rugged Jan 15, $180K losses) and $SCAMTOKEN (rugged Feb 2, $95K losses).',
      '5/ Funding chain: all deployer wallets trace back to a single source through 3 intermediate hops. Same cluster as the $RUGKING deployer from December.',
      '6/ Wallet cluster now tagged in Sentinel\'s knowledge graph. 14 wallets, 7 tokens, 4 confirmed rugs.',
      '7/ Risk Score: 91/100 — HIGH PROBABILITY FRAUD. Unlocked liquidity + concentrated holders + serial rugger deployer + coordinated buys.',
      '8/ Watching for: liquidity removal, deployer wallet movements, any fund transfers to mixers. Updates will follow.',
    ],
  },

  // ---- TYPE 2: Wallet of the Day ----
  walletOfDay: {
    maxTweets: 6,
    tweetMaxChars: 280,
    structure: [
      { role: 'intro', prompt: 'Introduce the wallet or cluster. Why it caught attention.' },
      { role: 'history', prompt: 'Wallet history: age, total tokens deployed, rug count.' },
      { role: 'network', prompt: 'Connected wallets and funding patterns.' },
      { role: 'methodology', prompt: 'The specific rug methodology this cluster uses.' },
      { role: 'total_damage', prompt: 'Total estimated losses across all rugs.' },
      { role: 'tracking', prompt: 'Current status: active or dormant? Any new tokens?' },
    ],
    variables: ['walletAddress', 'clusterData', 'rugHistory', 'totalLosses'],
  },

  // ---- TYPE 3: Pattern Report ----
  patternReport: {
    maxTweets: 6,
    tweetMaxChars: 280,
    structure: [
      { role: 'headline', prompt: 'This week in Solana rugs — headline stat (total rugs, total losses).' },
      { role: 'top_rugs', prompt: 'Top 3 biggest rugs this week with amounts.' },
      { role: 'trends', prompt: 'Emerging trends: new rug methodologies, platform shifts, timing patterns.' },
      { role: 'stats', prompt: 'By the numbers: total tokens launched, % flagged, % confirmed rug.' },
      { role: 'clusters', prompt: 'New clusters identified this week.' },
      { role: 'outlook', prompt: 'What to watch next week.' },
    ],
    variables: ['weeklyStats', 'topRugs', 'newClusters', 'trends'],
  },

  // ---- TYPE 4: Educational ----
  educational: {
    maxTweets: 7,
    tweetMaxChars: 280,
    topics: [
      'How to check if liquidity is locked (step by step)',
      'Red flags in token holder distribution',
      'What mint authority means and why it matters',
      'How to trace a deployer wallet\'s history',
      'Understanding sandwich attacks and how they drain you',
      'Why "audited" doesn\'t always mean safe',
      'How pump.fun tokens work and common scam patterns',
      'Reading Solscan like a forensic investigator',
      'What wallet clustering reveals about serial ruggers',
      'The anatomy of a slow rug (and how to spot one early)',
    ],
    structure: [
      { role: 'hook', prompt: 'Why this topic matters. One stat or example to grab attention.' },
      { role: 'concept', prompt: 'Explain the concept simply. No jargon.' },
      { role: 'step_1', prompt: 'First practical step the reader can take right now.' },
      { role: 'step_2', prompt: 'Second practical step with specific tool or website.' },
      { role: 'step_3', prompt: 'Third step or advanced technique.' },
      { role: 'real_example', prompt: 'Real anonymized example from recent investigation.' },
      { role: 'summary', prompt: 'TL;DR — the one thing to remember.' },
    ],
    variables: ['topic', 'exampleData'],
  },

  // ---- TYPE 5: Engagement ----
  engagement: {
    maxTweets: 1,
    tweetMaxChars: 280,
    subtypes: [
      {
        name: 'poll',
        templates: [
          'What\'s the biggest red flag that makes you instantly avoid a token?',
          'How many rugs have you personally been hit by this month?',
          'Which is worse: unlocked liquidity or active mint authority?',
          'Do you check the deployer wallet before buying? Be honest.',
        ],
      },
      {
        name: 'question',
        templates: [
          'Drop a token address below and I\'ll run a quick risk check.',
          'What rug methodology are you seeing most lately? Curious what\'s hitting CT.',
          'Which Solana scanner do you trust most? I have opinions.',
          'Anyone have a token they\'re suspicious about? I\'ll take a look.',
        ],
      },
      {
        name: 'commentary',
        templates: [
          'Watched 4 rugs in the last 6 hours. Same deployer cluster. They\'re not even trying to hide it anymore.',
          'The best indicator of a rug isn\'t any single metric. It\'s when 5 mediocre metrics all point the same direction.',
          'Every rug has the same Telegram playbook: launch, shill, pump, pull, delete group. Every. Single. Time.',
        ],
      },
    ],
    variables: [],
  },
};

// ============================================================
// SCHEDULER STATE
// ============================================================
let postsToday = 0;
let lastPostTime = 0;
let dailyContentLog = [];
let topicRotation = [...TEMPLATES.educational.topics];

// ============================================================
// CORE SCHEDULING FUNCTIONS
// ============================================================

/**
 * Check if it's time to post and what type of content to generate.
 * Called by the HEARTBEAT loop every 60 seconds.
 * 
 * @returns {Object|null} Content task to execute, or null if nothing due
 */
export function checkSchedule() {
  const now = new Date();
  const estHour = getESTHour(now);
  
  // Max posts reached
  if (postsToday >= SCHEDULE.maxPostsPerDay) {
    return null;
  }
  
  // Min gap not met
  const minutesSinceLastPost = (Date.now() - lastPostTime) / 60000;
  if (lastPostTime > 0 && minutesSinceLastPost < SCHEDULE.minGapMinutes) {
    return null;
  }
  
  // Find current slot
  const currentSlot = SCHEDULE.slots.find(s => estHour >= s.startHour && estHour < s.endHour);
  if (!currentSlot) return null;
  
  // Check if we already posted in this slot
  const slotUsed = dailyContentLog.some(log => log.slotId === currentSlot.id);
  if (slotUsed) return null;
  
  // Apply jitter — only post at the random time within the slot
  const slotJitter = getSlotJitterTime(currentSlot);
  if (now.getMinutes() < slotJitter) return null;
  
  // Determine content type
  const contentType = selectContentType(currentSlot);
  
  return {
    slotId: currentSlot.id,
    contentType,
    template: TEMPLATES[contentType],
    timestamp: Date.now(),
  };
}

/**
 * Select what type of content to post based on slot preference and daily mix.
 */
function selectContentType(slot) {
  const todayTypes = dailyContentLog.map(l => l.contentType);
  
  // Count what we've posted today
  const counts = {
    investigation: todayTypes.filter(t => t === 'investigation').length,
    walletOfDay: todayTypes.filter(t => t === 'walletOfDay').length,
    educational: todayTypes.filter(t => t === 'educational').length,
    engagement: todayTypes.filter(t => t === 'engagement').length,
    patternReport: todayTypes.filter(t => t === 'patternReport').length,
  };
  
  // Priority: investigation if available and under limit
  if (slot.preferredType === 'investigation' && counts.investigation < SCHEDULE.dailyMix.investigation) {
    return 'investigation';
  }
  
  // Fill gaps in daily mix
  if (counts.educational < SCHEDULE.dailyMix.educational) return 'educational';
  if (counts.engagement < SCHEDULE.dailyMix.engagement) return 'engagement';
  if (counts.walletOfDay < SCHEDULE.dailyMix.walletOfDay) return 'walletOfDay';
  
  // Pattern report (weekly)
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0 && counts.patternReport === 0) return 'patternReport'; // Sunday
  
  // Default to slot preference or engagement
  return slot.preferredType || 'engagement';
}

/**
 * Generate a random jitter time (minutes past the hour) for a slot.
 * Ensures we never post exactly on the hour (bot detection signal).
 */
function getSlotJitterTime(slot) {
  // Deterministic-ish jitter based on date + slot ID (same each day for consistency)
  const today = new Date().toISOString().slice(0, 10);
  const seed = hashCode(`${today}:${slot.id}`);
  const jitter = 5 + (Math.abs(seed) % (SCHEDULE.jitterMinutes * 2)); // 5-35 minutes
  return jitter;
}

/**
 * Record that a post was made.
 */
export function recordPost(contentType, slotId) {
  postsToday++;
  lastPostTime = Date.now();
  dailyContentLog.push({
    contentType,
    slotId,
    timestamp: Date.now(),
  });
  
  console.log(`[ContentEngine] Recorded post: ${contentType} (${postsToday}/${SCHEDULE.maxPostsPerDay} today)`);
}

/**
 * Get the next educational topic (rotates through list).
 */
export function getNextEducationalTopic() {
  if (topicRotation.length === 0) {
    topicRotation = [...TEMPLATES.educational.topics];
    // Shuffle
    topicRotation.sort(() => Math.random() - 0.5);
  }
  return topicRotation.pop();
}

/**
 * Get a random engagement template.
 */
export function getRandomEngagement() {
  const subtypes = TEMPLATES.engagement.subtypes;
  const subtype = subtypes[Math.floor(Math.random() * subtypes.length)];
  const template = subtype.templates[Math.floor(Math.random() * subtype.templates.length)];
  return { subtype: subtype.name, content: template };
}

/**
 * Get content template for a specific type.
 */
export function getTemplate(contentType) {
  return TEMPLATES[contentType] || null;
}

/**
 * Reset daily counters (called at midnight EST).
 */
export function resetDaily() {
  postsToday = 0;
  lastPostTime = 0;
  dailyContentLog = [];
  console.log('[ContentEngine] Daily counters reset');
}

/**
 * Get current scheduling stats.
 */
export function getStats() {
  return {
    postsToday,
    maxPosts: SCHEDULE.maxPostsPerDay,
    lastPostTime: lastPostTime > 0 ? new Date(lastPostTime).toISOString() : null,
    todayLog: dailyContentLog,
    nextSlot: getNextAvailableSlot(),
  };
}

function getNextAvailableSlot() {
  const estHour = getESTHour(new Date());
  const usedSlots = new Set(dailyContentLog.map(l => l.slotId));
  
  return SCHEDULE.slots.find(s => s.startHour > estHour && !usedSlots.has(s.id)) || null;
}

// ============================================================
// UTILITIES
// ============================================================

function getESTHour(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

// ============================================================
// INITIALIZATION
// ============================================================

export function init() {
  console.log('[ContentEngine] Initialized');
  console.log(`[ContentEngine] ${SCHEDULE.slots.length} time slots configured`);
  console.log(`[ContentEngine] Max ${SCHEDULE.maxPostsPerDay} posts/day, ${SCHEDULE.minGapMinutes}min gap`);
  
  // Shuffle educational topics on init
  topicRotation.sort(() => Math.random() - 0.5);
  
  // Schedule midnight reset
  scheduleMidnightReset();
  
  return { status: 'ok' };
}

function scheduleMidnightReset() {
  const now = new Date();
  const estMidnight = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  estMidnight.setHours(24, 0, 0, 0);
  
  const msUntilMidnight = estMidnight.getTime() - Date.now();
  
  setTimeout(() => {
    resetDaily();
    // Re-schedule for next midnight
    setInterval(resetDaily, 86400000);
  }, msUntilMidnight);
}

export default {
  init,
  checkSchedule,
  recordPost,
  getNextEducationalTopic,
  getRandomEngagement,
  getTemplate,
  resetDaily,
  getStats,
  TEMPLATES,
};
