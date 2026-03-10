/**
 * SENTINEL — Developer / Social Profiler
 * ========================================
 * When Sentinel investigates a token, this module profiles the team behind it.
 * 
 * Four analysis vectors:
 *   A) GitHub Analysis — repo history, contribution patterns, forked code detection
 *   B) LinkedIn Lookup — team verification, phantom team detection
 *   C) Twitter/Social Analysis — account age, bot detection, promotion patterns
 *   D) Composite credibility score (0-100)
 * 
 * Uses OpenClaw skills: GitHub (off-the-shelf), Tavily Web Search, Agent Browser
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// CREDIBILITY SCORING WEIGHTS
// ============================================================
const WEIGHTS = {
  github: 0.30,       // 30% — code history is strongest signal
  linkedin: 0.20,     // 20% — team legitimacy
  twitter: 0.25,      // 25% — social presence and patterns
  crossReference: 0.25, // 25% — consistency across platforms
};

// ============================================================
// A) GITHUB ANALYSIS
// ============================================================

/**
 * Analyze a GitHub profile for developer credibility signals.
 * Uses the off-the-shelf OpenClaw GitHub skill for API access.
 * 
 * @param {string} githubUrl - GitHub profile URL or username
 * @returns {Object} GitHub analysis results
 */
export async function analyzeGitHub(githubUrl) {
  const findings = [];
  let score = 50; // Neutral start

  if (!githubUrl) {
    return {
      score: 65, // No GitHub = mild red flag for crypto project
      findings: ['No GitHub profile linked — cannot verify development history'],
      redFlags: ['No verifiable code history'],
      greenFlags: [],
    };
  }

  const username = extractGitHubUsername(githubUrl);
  
  try {
    // These would call the OpenClaw GitHub skill in production
    const profile = await fetchGitHubProfile(username);
    const repos = await fetchGitHubRepos(username);
    
    // Account Age
    const accountAgeDays = daysSince(profile.created_at);
    if (accountAgeDays < 30) {
      score += 25;
      findings.push(`GitHub account is only ${accountAgeDays} days old — FRESH`);
    } else if (accountAgeDays < 180) {
      score += 10;
      findings.push(`GitHub account is ${accountAgeDays} days old — relatively new`);
    } else {
      score -= 15;
      findings.push(`GitHub account is ${Math.floor(accountAgeDays / 365)} years old — established`);
    }

    // Public Repos
    if (repos.length === 0) {
      score += 20;
      findings.push('Zero public repositories — empty profile');
    } else if (repos.length < 3) {
      score += 10;
      findings.push(`Only ${repos.length} public repos`);
    } else {
      score -= 10;
      findings.push(`${repos.length} public repositories`);
    }

    // Fork Analysis — are they just forking or actually building?
    const forkedRepos = repos.filter(r => r.fork);
    const forkRatio = repos.length > 0 ? forkedRepos.length / repos.length : 0;
    if (forkRatio > 0.8) {
      score += 15;
      findings.push(`${Math.round(forkRatio * 100)}% of repos are forks — minimal original work`);
    } else if (forkRatio > 0.5) {
      score += 5;
      findings.push(`${Math.round(forkRatio * 100)}% fork ratio — mixed`);
    }

    // Contribution Activity
    const hasRecentCommits = repos.some(r => {
      const pushDate = new Date(r.pushed_at);
      return (Date.now() - pushDate.getTime()) < 90 * 86400000; // 90 days
    });
    if (!hasRecentCommits) {
      score += 10;
      findings.push('No commits in last 90 days — dormant account');
    }

    // Stars (social proof of code quality)
    const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
    if (totalStars > 100) {
      score -= 20;
      findings.push(`${totalStars} total stars across repos — established developer`);
    } else if (totalStars > 10) {
      score -= 5;
      findings.push(`${totalStars} total stars`);
    }

    // Crypto-specific patterns
    const cryptoRepos = repos.filter(r => {
      const name = (r.name + ' ' + (r.description || '')).toLowerCase();
      return /token|swap|defi|solana|ethereum|nft|mint|airdrop|pump/.test(name);
    });
    if (cryptoRepos.length > 3) {
      score += 15;
      findings.push(`${cryptoRepos.length} crypto-related repos — serial token deployer pattern`);
    }

    // Sudden burst pattern (account dormant then suddenly active before launch)
    const recentRepos = repos.filter(r => daysSince(r.created_at) < 14);
    if (recentRepos.length > 2 && accountAgeDays > 180) {
      score += 15;
      findings.push(`${recentRepos.length} repos created in last 2 weeks on old account — activity burst before launch`);
    }

  } catch (error) {
    findings.push(`GitHub analysis failed: ${error.message}`);
    score = 55; // Slight red flag — couldn't verify
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  
  return {
    score: clampedScore,
    findings,
    redFlags: findings.filter(f => /FRESH|empty|forks|burst|serial|dormant|failed/i.test(f)),
    greenFlags: findings.filter(f => /established|stars|years old/i.test(f)),
  };
}

// ============================================================
// B) LINKEDIN LOOKUP
// ============================================================

/**
 * Attempt to verify team members via web search.
 * Uses Tavily Web Search skill for OSINT lookups.
 * 
 * @param {Object} teamClaims - Claimed team members from token metadata
 * @returns {Object} LinkedIn analysis results
 */
export async function analyzeLinkedIn(teamClaims) {
  const findings = [];
  let score = 50;

  if (!teamClaims || !teamClaims.members || teamClaims.members.length === 0) {
    return {
      score: 60,
      findings: ['No team members listed — anonymous project'],
      phantomTeam: false,
      verifiedMembers: 0,
      totalClaimed: 0,
    };
  }

  const members = teamClaims.members;
  let verified = 0;
  let suspicious = 0;
  let notFound = 0;

  for (const member of members) {
    const result = await searchPerson(member);
    
    if (result.found && result.profileMatch) {
      verified++;
      findings.push(`Verified: ${member.name} — LinkedIn matches claimed role (${member.role})`);
    } else if (result.found && !result.profileMatch) {
      suspicious++;
      findings.push(`Suspicious: ${member.name} found on LinkedIn but role doesn't match claimed "${member.role}"`);
    } else {
      notFound++;
      findings.push(`Not found: ${member.name} (${member.role}) — no LinkedIn or web presence`);
    }
  }

  // Scoring
  const verificationRate = members.length > 0 ? verified / members.length : 0;
  
  if (verificationRate === 0 && members.length > 1) {
    score = 85; // All claimed members are ghosts
    findings.push('PHANTOM TEAM: None of the claimed team members could be verified');
  } else if (verificationRate < 0.3) {
    score = 70;
    findings.push(`Low verification rate: only ${Math.round(verificationRate * 100)}% of team verified`);
  } else if (verificationRate > 0.7) {
    score = 20;
    findings.push(`High verification rate: ${Math.round(verificationRate * 100)}% of team verified`);
  }

  // Fake name patterns
  const suspiciousNames = members.filter(m => {
    const name = m.name.toLowerCase();
    return /crypto|defi|moon|rocket|alpha|whale|anon/i.test(name);
  });
  if (suspiciousNames.length > 0) {
    score += 10;
    findings.push(`${suspiciousNames.length} team member(s) using crypto-themed pseudonyms`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    phantomTeam: verificationRate === 0 && members.length > 1,
    verifiedMembers: verified,
    totalClaimed: members.length,
  };
}

// ============================================================
// C) TWITTER / SOCIAL ANALYSIS
// ============================================================

/**
 * Analyze the project's Twitter presence and the deployer's social patterns.
 * Uses Agent Browser skill for scraping (Twikit/Twscrape).
 * 
 * @param {Object} socialData - Twitter handle, follower data, etc.
 * @returns {Object} Twitter analysis results
 */
export async function analyzeTwitter(socialData) {
  const findings = [];
  let score = 50;

  if (!socialData || !socialData.twitterHandle) {
    return {
      score: 55,
      findings: ['No Twitter account linked to project'],
      botProbability: 0,
      redFlags: [],
    };
  }

  try {
    const profile = await fetchTwitterProfile(socialData.twitterHandle);
    
    // Account Age
    const accountAgeDays = profile.accountAgeDays || 0;
    if (accountAgeDays < 7) {
      score += 25;
      findings.push(`Twitter account is ${accountAgeDays} days old — created right before launch`);
    } else if (accountAgeDays < 30) {
      score += 15;
      findings.push(`Twitter account is ${accountAgeDays} days old — very new`);
    } else if (accountAgeDays > 365) {
      score -= 10;
      findings.push(`Twitter account is ${Math.floor(accountAgeDays / 365)}+ years old`);
    }

    // Follower Quality
    const followerCount = profile.followers || 0;
    const followingCount = profile.following || 0;
    
    // Follower/following ratio analysis
    if (followerCount > 0 && followingCount / followerCount > 5) {
      score += 15;
      findings.push(`Following/follower ratio: ${(followingCount / followerCount).toFixed(1)}x — follow-farming pattern`);
    }

    // Bot Detection Heuristics
    let botScore = 0;
    
    // Pattern 1: High tweet frequency (>50/day average)
    const tweetCount = profile.tweetCount || 0;
    const tweetsPerDay = accountAgeDays > 0 ? tweetCount / accountAgeDays : 0;
    if (tweetsPerDay > 50) {
      botScore += 30;
      findings.push(`${tweetsPerDay.toFixed(0)} tweets/day average — bot-like frequency`);
    }

    // Pattern 2: All tweets within business hours or all at night
    if (profile.tweetTimingPattern === 'robotic') {
      botScore += 25;
      findings.push('Tweet timing shows robotic pattern (identical intervals)');
    }

    // Pattern 3: Engagement ratio (likes+RTs per tweet)
    const engagementRate = profile.avgEngagement || 0;
    if (followerCount > 1000 && engagementRate < 0.1) {
      botScore += 20;
      findings.push(`Low engagement rate (${(engagementRate * 100).toFixed(2)}%) despite ${followerCount} followers — likely fake followers`);
    }

    // Pattern 4: Generic bio with emoji spam
    if (profile.bioPattern === 'generic_crypto') {
      botScore += 10;
      findings.push('Bio matches generic crypto project template');
    }

    score += Math.min(botScore * 0.5, 25); // Cap bot contribution to score

    // Previous Project Promotions
    const previousProjects = profile.previousPromotions || [];
    if (previousProjects.length > 3) {
      score += 20;
      findings.push(`Account has promoted ${previousProjects.length} previous crypto projects — serial promoter`);
      previousProjects.slice(0, 3).forEach(p => {
        findings.push(`  Previously promoted: ${p.name} (${p.status || 'unknown status'})`);
      });
    }

    // Purchased followers check (sudden follower spikes)
    if (profile.followerSpikes && profile.followerSpikes.length > 0) {
      score += 15;
      findings.push(`Detected ${profile.followerSpikes.length} sudden follower spike(s) — likely purchased followers`);
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      findings,
      botProbability: Math.min(botScore, 100),
      redFlags: findings.filter(f => /bot|fake|serial|purchased|farming|created right/i.test(f)),
    };

  } catch (error) {
    return {
      score: 55,
      findings: [`Twitter analysis failed: ${error.message}`],
      botProbability: 0,
      redFlags: [],
    };
  }
}

// ============================================================
// D) CROSS-REFERENCE ANALYSIS
// ============================================================

/**
 * Cross-reference findings across all platforms for consistency.
 */
function crossReferenceAnalysis(github, linkedin, twitter, tokenData) {
  const findings = [];
  let score = 50;

  // Check if GitHub username matches social claims
  if (github.score < 40 && twitter.score > 70) {
    score += 15;
    findings.push('Inconsistency: legitimate GitHub but suspicious Twitter — possible hijacked/bought account');
  }

  if (github.score > 70 && twitter.score < 30) {
    score += 10;
    findings.push('Inconsistency: suspicious GitHub but clean Twitter — code may be stolen/forked');
  }

  // Phantom team + good GitHub = one dev with fake team
  if (linkedin.phantomTeam && github.score < 50) {
    score += 20;
    findings.push('Pattern: phantom team claims but only one active developer — inflating team size');
  }

  // All platforms clean = strong signal
  if (github.score < 35 && linkedin.score < 35 && twitter.score < 35) {
    score = 10;
    findings.push('All platforms show consistent, legitimate presence — low risk developer profile');
  }

  // All platforms suspicious = very strong signal
  if (github.score > 65 && twitter.score > 65) {
    score = 90;
    findings.push('Multiple platforms show high-risk patterns — strong fraud indicators');
  }

  // Token age vs social age mismatch
  const tokenAgeDays = tokenData.ageDays || 0;
  if (tokenAgeDays < 1 && twitter.findings.some(f => /years old/.test(f))) {
    findings.push('Note: old social accounts promoting brand new token — could be legitimate pivot or purchased accounts');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
  };
}

// ============================================================
// MAIN PROFILER FUNCTION
// ============================================================

/**
 * Run full developer/social profiling for a token investigation.
 * 
 * @param {Object} tokenData - Token metadata including claimed team, socials
 * @param {Object} deployerData - Deployer wallet data (may include linked socials)
 * @returns {Object} Complete credibility assessment
 */
export async function profileDeveloper(tokenData, deployerData = {}) {
  console.log(`[Profiler] Profiling developer for: ${tokenData.name || tokenData.mint || 'unknown'}`);
  const startTime = Date.now();

  // Run analyses in parallel
  const [githubResult, linkedinResult, twitterResult] = await Promise.all([
    analyzeGitHub(tokenData.githubUrl || deployerData.githubUrl),
    analyzeLinkedIn(tokenData.team),
    analyzeTwitter({
      twitterHandle: tokenData.socials?.twitter || deployerData.twitterHandle,
    }),
  ]);

  // Cross-reference all findings
  const crossRef = crossReferenceAnalysis(githubResult, linkedinResult, twitterResult, tokenData);

  // Calculate weighted composite score
  const compositeScore = Math.round(
    githubResult.score * WEIGHTS.github +
    linkedinResult.score * WEIGHTS.linkedin +
    twitterResult.score * WEIGHTS.twitter +
    crossRef.score * WEIGHTS.crossReference
  );

  const finalScore = Math.max(0, Math.min(100, compositeScore));

  // Compile all evidence
  const allFindings = [
    ...githubResult.findings.map(f => `[GitHub] ${f}`),
    ...linkedinResult.findings.map(f => `[LinkedIn] ${f}`),
    ...twitterResult.findings.map(f => `[Twitter] ${f}`),
    ...crossRef.findings.map(f => `[CrossRef] ${f}`),
  ];

  const allRedFlags = [
    ...githubResult.redFlags,
    ...(linkedinResult.phantomTeam ? ['Phantom team detected'] : []),
    ...twitterResult.redFlags,
  ];

  const result = {
    credibilityScore: finalScore,
    riskLevel: finalScore > 70 ? 'HIGH' : finalScore > 40 ? 'MEDIUM' : 'LOW',
    analysisTimeMs: Date.now() - startTime,

    breakdown: {
      github: { score: githubResult.score, weight: WEIGHTS.github },
      linkedin: { score: linkedinResult.score, weight: WEIGHTS.linkedin },
      twitter: { score: twitterResult.score, weight: WEIGHTS.twitter },
      crossReference: { score: crossRef.score, weight: WEIGHTS.crossReference },
    },

    findings: allFindings,
    redFlags: allRedFlags,
    greenFlags: githubResult.greenFlags || [],
    phantomTeam: linkedinResult.phantomTeam,
    botProbability: twitterResult.botProbability,

    // For Neo4j storage
    developerNode: {
      github_url: tokenData.githubUrl || deployerData.githubUrl || null,
      linkedin_url: tokenData.team?.website || null,
      twitter_handle: tokenData.socials?.twitter || null,
      credibility_score: finalScore,
      risk_level: finalScore > 70 ? 'HIGH' : finalScore > 40 ? 'MEDIUM' : 'LOW',
      phantom_team: linkedinResult.phantomTeam,
      bot_probability: twitterResult.botProbability,
      profiled_at: new Date().toISOString(),
    },
  };

  console.log(`[Profiler] ${tokenData.name || 'unknown'}: Credibility=${finalScore} Risk=${result.riskLevel} (${Date.now() - startTime}ms)`);

  return result;
}

// ============================================================
// HELPER FUNCTIONS (Skill adapters)
// ============================================================

function extractGitHubUsername(url) {
  if (!url) return null;
  // Handle full URLs and bare usernames
  const match = url.match(/github\.com\/([^\/\s]+)/);
  return match ? match[1] : url.replace(/^@/, '');
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

/**
 * Fetch GitHub profile via OpenClaw GitHub skill.
 * In production, this calls the skill's API.
 */
async function fetchGitHubProfile(username) {
  // OpenClaw GitHub skill adapter
  // skill.github.getUser(username)
  return {
    login: username,
    created_at: null,
    public_repos: 0,
    followers: 0,
    following: 0,
  };
}

async function fetchGitHubRepos(username) {
  // skill.github.listRepos(username, { sort: 'updated', per_page: 30 })
  return [];
}

/**
 * Search for a person via Tavily Web Search skill.
 */
async function searchPerson(member) {
  // skill.tavily.search(`${member.name} ${member.role} LinkedIn`)
  return {
    found: false,
    profileMatch: false,
    confidence: 0,
  };
}

/**
 * Fetch Twitter profile via Agent Browser skill (Twikit/Twscrape).
 */
async function fetchTwitterProfile(handle) {
  // skill.agentBrowser.scrape(`https://twitter.com/${handle}`)
  // Then parse the response for profile data
  return {
    handle: handle,
    accountAgeDays: 0,
    followers: 0,
    following: 0,
    tweetCount: 0,
    avgEngagement: 0,
    tweetTimingPattern: 'unknown',
    bioPattern: 'unknown',
    previousPromotions: [],
    followerSpikes: [],
  };
}

export default { profileDeveloper, analyzeGitHub, analyzeLinkedIn, analyzeTwitter };
