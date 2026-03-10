/**
 * SENTINEL — Twitter Integration Layer
 * ======================================
 * OpenClaw Twitter channel adapter with anti-detection measures.
 * Covers GAP #1: Twitter account detection/ban risk.
 * 
 * Uses Twikit/Twscrape for free scraping (no paid API needed).
 * Rate limiter, varied sentence structures, engagement tracking.
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  credentials: {
    username: process.env.TWITTER_USERNAME,
    password: process.env.TWITTER_PASSWORD,
    email: process.env.TWITTER_EMAIL || '',
  },
  rateLimits: {
    maxPostsPerDay: 6,
    maxPostsPerHour: 2,
    maxRepliesPerDay: 20,
    maxRepliesPerAccount: 2,   // Don't reply to same person >2x/day
    maxFollowsPerDay: 50,
    minPostGapMinutes: 120,
    minReplyGapMinutes: 15,
  },
  antiDetection: {
    avoidExactHours: true,       // Never post at :00
    avoidExactHalfHours: true,   // Never post at :30
    jitterRangeMinutes: 15,
    varyStructure: true,         // Use Humanizer skill
    randomizeMediaAttachment: true,
  },
};

// ============================================================
// STATE
// ============================================================
let postsToday = 0;
let postsThisHour = 0;
let repliesToday = 0;
let followsToday = 0;
let lastPostTime = 0;
let lastReplyTime = 0;
const replyTracker = new Map(); // accountHandle -> replyCount today
const engagementLog = [];       // All engagement data for analytics

// ============================================================
// POSTING (with anti-detection)
// ============================================================

/**
 * Post a tweet with anti-detection measures.
 * Returns { posted, tweetId, reason } 
 */
export async function postTweet(content, options = {}) {
  // Rate limit checks
  if (postsToday >= CONFIG.rateLimits.maxPostsPerDay) {
    return { posted: false, reason: 'daily_limit_reached' };
  }
  if (postsThisHour >= CONFIG.rateLimits.maxPostsPerHour) {
    return { posted: false, reason: 'hourly_limit_reached' };
  }
  
  const minutesSinceLast = (Date.now() - lastPostTime) / 60000;
  if (lastPostTime > 0 && minutesSinceLast < CONFIG.rateLimits.minPostGapMinutes) {
    return { posted: false, reason: `gap_too_short: ${minutesSinceLast.toFixed(0)}min < ${CONFIG.rateLimits.minPostGapMinutes}min` };
  }
  
  // Anti-detection: check timing
  if (CONFIG.antiDetection.avoidExactHours) {
    const minutes = new Date().getMinutes();
    if (minutes === 0 || minutes === 30) {
      return { posted: false, reason: 'exact_hour_avoided — retry in 1min' };
    }
  }
  
  // Apply Humanizer if enabled
  let finalContent = content;
  if (CONFIG.antiDetection.varyStructure && !options.skipHumanizer) {
    finalContent = await humanizeContent(content);
  }
  
  // Validate tweet length
  if (typeof finalContent === 'string' && finalContent.length > 280) {
    finalContent = finalContent.slice(0, 277) + '...';
  }
  
  try {
    // In production, this calls Twikit/Twscrape via OpenClaw
    const result = await twitkitPost(finalContent, options);
    
    // Update state
    postsToday++;
    postsThisHour++;
    lastPostTime = Date.now();
    
    // Log for engagement tracking
    engagementLog.push({
      type: 'post',
      tweetId: result.tweetId,
      content: finalContent.slice(0, 100),
      timestamp: Date.now(),
      metrics: { likes: 0, retweets: 0, replies: 0, impressions: 0 },
    });
    
    console.log(`[Twitter] Posted tweet (${postsToday}/${CONFIG.rateLimits.maxPostsPerDay} today)`);
    return { posted: true, tweetId: result.tweetId };
    
  } catch (error) {
    console.error(`[Twitter] Post failed: ${error.message}`);
    return { posted: false, reason: error.message };
  }
}

/**
 * Post a thread (array of tweets).
 */
export async function postThread(tweets, options = {}) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return { posted: false, reason: 'empty_thread' };
  }
  
  // Rate limit check for entire thread
  if (postsToday >= CONFIG.rateLimits.maxPostsPerDay) {
    return { posted: false, reason: 'daily_limit_reached' };
  }
  
  const results = [];
  let previousTweetId = null;
  
  for (let i = 0; i < tweets.length; i++) {
    let content = tweets[i];
    
    // Add thread numbering if not present
    if (!content.startsWith(`${i + 1}/`)) {
      content = `${i + 1}/ ${content}`;
    }
    
    // Humanize each tweet individually for variety
    if (CONFIG.antiDetection.varyStructure && !options.skipHumanizer) {
      content = await humanizeContent(content);
    }
    
    try {
      const result = await twitkitPost(content, {
        ...options,
        replyTo: previousTweetId,
      });
      
      previousTweetId = result.tweetId;
      results.push({ index: i, posted: true, tweetId: result.tweetId });
      
      // Small delay between thread tweets (1-3 seconds)
      if (i < tweets.length - 1) {
        await sleep(1000 + Math.random() * 2000);
      }
    } catch (error) {
      results.push({ index: i, posted: false, error: error.message });
      break; // Stop thread on error
    }
  }
  
  // Count thread as 1 post for rate limiting
  postsToday++;
  postsThisHour++;
  lastPostTime = Date.now();
  
  engagementLog.push({
    type: 'thread',
    tweetIds: results.filter(r => r.posted).map(r => r.tweetId),
    length: tweets.length,
    timestamp: Date.now(),
  });
  
  console.log(`[Twitter] Posted thread: ${results.filter(r => r.posted).length}/${tweets.length} tweets`);
  return { posted: true, results };
}

/**
 * Reply to a tweet with cooldown per account.
 */
export async function replyToTweet(tweetId, content, authorHandle) {
  if (repliesToday >= CONFIG.rateLimits.maxRepliesPerDay) {
    return { replied: false, reason: 'daily_reply_limit' };
  }
  
  // Per-account reply limit
  const accountReplies = replyTracker.get(authorHandle) || 0;
  if (accountReplies >= CONFIG.rateLimits.maxRepliesPerAccount) {
    return { replied: false, reason: `already_replied_${accountReplies}x_to_${authorHandle}` };
  }
  
  const minutesSinceLastReply = (Date.now() - lastReplyTime) / 60000;
  if (lastReplyTime > 0 && minutesSinceLastReply < CONFIG.rateLimits.minReplyGapMinutes) {
    return { replied: false, reason: 'reply_cooldown' };
  }
  
  try {
    const result = await twitkitPost(content, { replyTo: tweetId });
    
    repliesToday++;
    lastReplyTime = Date.now();
    replyTracker.set(authorHandle, accountReplies + 1);
    
    return { replied: true, tweetId: result.tweetId };
  } catch (error) {
    return { replied: false, reason: error.message };
  }
}

// ============================================================
// SCRAPING (Read operations — for investigation)
// ============================================================

/**
 * Scrape a Twitter profile for investigation data.
 * Uses Twikit/Twscrape (free, no API key needed).
 */
export async function scrapeProfile(handle) {
  try {
    // In production: twikit.get_user_by_screen_name(handle)
    return {
      handle,
      found: true,
      accountAgeDays: 0,
      followers: 0,
      following: 0,
      tweetCount: 0,
      bio: '',
      // Will be populated by actual scraper
    };
  } catch (error) {
    return { handle, found: false, error: error.message };
  }
}

/**
 * Scrape recent tweets from a profile.
 */
export async function scrapeTimeline(handle, count = 20) {
  try {
    // In production: twikit.get_user_tweets(handle, count)
    return { handle, tweets: [], count: 0 };
  } catch (error) {
    return { handle, tweets: [], error: error.message };
  }
}

// ============================================================
// ENGAGEMENT TRACKING
// ============================================================

/**
 * Update engagement metrics for a posted tweet.
 * Called periodically to track performance.
 */
export async function updateEngagement(tweetId) {
  try {
    // In production: scrape the tweet to get current metrics
    const metrics = await scrapeTweetMetrics(tweetId);
    
    const logEntry = engagementLog.find(e => 
      e.tweetId === tweetId || (e.tweetIds && e.tweetIds.includes(tweetId))
    );
    
    if (logEntry) {
      logEntry.metrics = metrics;
      logEntry.lastChecked = Date.now();
    }
    
    return metrics;
  } catch (error) {
    return null;
  }
}

/**
 * Get engagement summary for content strategy optimization.
 */
export function getEngagementSummary() {
  const posts = engagementLog.filter(e => e.type === 'post');
  const threads = engagementLog.filter(e => e.type === 'thread');
  
  const avgPostEngagement = posts.length > 0 
    ? posts.reduce((sum, p) => sum + (p.metrics?.likes || 0) + (p.metrics?.retweets || 0), 0) / posts.length
    : 0;
  
  const avgThreadEngagement = threads.length > 0
    ? threads.reduce((sum, t) => sum + (t.metrics?.likes || 0) + (t.metrics?.retweets || 0), 0) / threads.length
    : 0;
  
  return {
    totalPosts: posts.length,
    totalThreads: threads.length,
    avgPostEngagement,
    avgThreadEngagement,
    topPerforming: [...engagementLog]
      .sort((a, b) => ((b.metrics?.likes || 0) + (b.metrics?.retweets || 0)) - ((a.metrics?.likes || 0) + (a.metrics?.retweets || 0)))
      .slice(0, 5),
  };
}

// ============================================================
// SKILL ADAPTERS (Twikit/Twscrape)
// ============================================================

async function twitkitPost(content, options = {}) {
  // OpenClaw Twikit skill adapter
  // In production: skill.twikit.createTweet({ text: content, reply_to: options.replyTo })
  return { tweetId: `mock_${Date.now()}` };
}

async function scrapeTweetMetrics(tweetId) {
  // skill.twikit.getTweetById(tweetId) -> extract metrics
  return { likes: 0, retweets: 0, replies: 0, impressions: 0 };
}

async function humanizeContent(content) {
  // skill.humanizer.humanize(content)
  // Varies sentence structure, synonyms, punctuation patterns
  return content; // Pass-through until skill is wired
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// LIFECYCLE
// ============================================================

export function init() {
  console.log('[Twitter] Initializing...');
  console.log(`[Twitter] Limits: ${CONFIG.rateLimits.maxPostsPerDay} posts/day, ${CONFIG.rateLimits.maxRepliesPerDay} replies/day`);
  
  // Reset daily counters at midnight
  setInterval(() => {
    postsToday = 0;
    postsThisHour = 0;
    repliesToday = 0;
    followsToday = 0;
    replyTracker.clear();
  }, 86400000);
  
  // Reset hourly counter
  setInterval(() => { postsThisHour = 0; }, 3600000);
  
  return { status: 'ok' };
}

export function getStats() {
  return {
    postsToday,
    postsThisHour,
    repliesToday,
    followsToday,
    lastPostTime: lastPostTime > 0 ? new Date(lastPostTime).toISOString() : null,
    engagementLogSize: engagementLog.length,
  };
}

export default { init, getStats, postTweet, postThread, replyToTweet, scrapeProfile, scrapeTimeline, updateEngagement, getEngagementSummary };
