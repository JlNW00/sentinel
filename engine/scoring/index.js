/**
 * SENTINEL — Forensic Scoring Engine
 * ====================================
 * Three-layer token risk analysis:
 *   Layer 1: Token Vitals (liquidity, holders, mint authority)
 *   Layer 2: Behavioral Analysis (wash trading, sniping, MEV/sandwich)
 *   Layer 3: Metadata Forensics (website, socials, deployer history)
 * 
 * Outputs a 0-100 risk score with per-layer breakdown and evidence chain.
 * Feeds into the confidence-gated language system (SOUL.md).
 */

import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// SCORING WEIGHTS
// ============================================================
const WEIGHTS = {
  layer1: {
    total: 0.35,  // 35% of final score
    liquidityLock: 0.25,
    lpBurn: 0.15,
    holderConcentration: 0.25,
    mintAuthority: 0.20,
    supplyDistribution: 0.15,
  },
  layer2: {
    total: 0.35,  // 35% of final score
    coordinatedBuys: 0.25,
    washTrading: 0.25,
    sniperWallets: 0.20,
    mevSandwich: 0.15,
    volumeAnomaly: 0.15,
  },
  layer3: {
    total: 0.30,  // 30% of final score
    websiteQuality: 0.20,
    socialPresence: 0.20,
    deployerHistory: 0.30,
    codeOriginality: 0.15,
    auditStatus: 0.15,
  },
};

// ============================================================
// CONFIDENCE TIER MAPPING (matches SOUL.md)
// ============================================================
const CONFIDENCE_TIERS = {
  OBSERVATION:       { min: 0,  max: 69, label: 'OBSERVATION' },
  RED_FLAGS:         { min: 70, max: 84, label: 'RED_FLAGS' },
  HIGH_PROBABILITY:  { min: 85, max: 94, label: 'HIGH_PROBABILITY' },
  CONFIRMED:         { min: 95, max: 100, label: 'CONFIRMED' },
};

function getConfidenceTier(score) {
  for (const [key, tier] of Object.entries(CONFIDENCE_TIERS)) {
    if (score >= tier.min && score <= tier.max) return tier.label;
  }
  return 'OBSERVATION';
}

// ============================================================
// LAYER 1: TOKEN VITALS
// ============================================================
async function analyzeTokenVitals(tokenData, connection) {
  const evidence = [];
  const scores = {};

  // 1a. Liquidity Lock Status
  // Check if LP tokens are locked in a known locker (e.g., Raydium locker, Team Finance)
  const lpLocked = tokenData.lpLocked || false;
  const lpLockDuration = tokenData.lpLockDurationDays || 0;
  
  if (!lpLocked) {
    scores.liquidityLock = 90; // Very high risk
    evidence.push('Liquidity is NOT locked — deployer can pull at any time');
  } else if (lpLockDuration < 30) {
    scores.liquidityLock = 60;
    evidence.push(`Liquidity locked for only ${lpLockDuration} days — short lock period`);
  } else if (lpLockDuration < 180) {
    scores.liquidityLock = 30;
    evidence.push(`Liquidity locked for ${lpLockDuration} days`);
  } else {
    scores.liquidityLock = 10;
    evidence.push(`Liquidity locked for ${lpLockDuration} days — reasonable`);
  }

  // 1b. LP Token Burn
  const lpBurnPct = tokenData.lpBurnPercent || 0;
  if (lpBurnPct >= 95) {
    scores.lpBurn = 5;
    evidence.push(`${lpBurnPct}% of LP tokens burned — strong commitment`);
  } else if (lpBurnPct >= 50) {
    scores.lpBurn = 30;
    evidence.push(`${lpBurnPct}% LP burned — partial commitment`);
  } else {
    scores.lpBurn = 75;
    evidence.push(`Only ${lpBurnPct}% LP burned — most LP tokens still held`);
  }

  // 1c. Holder Concentration (Top 10 wallets)
  const top10Pct = tokenData.top10HolderPercent || 0;
  if (top10Pct > 80) {
    scores.holderConcentration = 95;
    evidence.push(`Top 10 wallets hold ${top10Pct}% — extreme concentration`);
  } else if (top10Pct > 60) {
    scores.holderConcentration = 70;
    evidence.push(`Top 10 wallets hold ${top10Pct}% — high concentration`);
  } else if (top10Pct > 40) {
    scores.holderConcentration = 40;
    evidence.push(`Top 10 wallets hold ${top10Pct}% — moderate concentration`);
  } else {
    scores.holderConcentration = 15;
    evidence.push(`Top 10 wallets hold ${top10Pct}% — well distributed`);
  }

  // 1d. Mint Authority
  const mintRevoked = tokenData.mintAuthorityRevoked || false;
  if (!mintRevoked) {
    scores.mintAuthority = 85;
    evidence.push('Mint authority NOT revoked — deployer can mint unlimited tokens');
  } else {
    scores.mintAuthority = 5;
    evidence.push('Mint authority revoked — supply is fixed');
  }

  // 1e. Supply Distribution (Gini Coefficient)
  const gini = calculateGiniCoefficient(tokenData.holderBalances || []);
  if (gini > 0.9) {
    scores.supplyDistribution = 90;
    evidence.push(`Gini coefficient: ${gini.toFixed(3)} — extreme inequality`);
  } else if (gini > 0.7) {
    scores.supplyDistribution = 55;
    evidence.push(`Gini coefficient: ${gini.toFixed(3)} — high inequality`);
  } else if (gini > 0.5) {
    scores.supplyDistribution = 30;
    evidence.push(`Gini coefficient: ${gini.toFixed(3)} — moderate distribution`);
  } else {
    scores.supplyDistribution = 10;
    evidence.push(`Gini coefficient: ${gini.toFixed(3)} — well distributed`);
  }

  // Calculate weighted Layer 1 score
  const layerScore = (
    scores.liquidityLock * WEIGHTS.layer1.liquidityLock +
    scores.lpBurn * WEIGHTS.layer1.lpBurn +
    scores.holderConcentration * WEIGHTS.layer1.holderConcentration +
    scores.mintAuthority * WEIGHTS.layer1.mintAuthority +
    scores.supplyDistribution * WEIGHTS.layer1.supplyDistribution
  );

  return { score: layerScore, scores, evidence };
}

// ============================================================
// LAYER 2: BEHAVIORAL ANALYSIS
// ============================================================
async function analyzeBehavior(tokenData, transactions, connection) {
  const evidence = [];
  const scores = {};

  // 2a. Coordinated Buy Detection
  // Look for N wallets buying in the same block or within seconds
  const coordinated = detectCoordinatedBuys(transactions);
  if (coordinated.count > 5) {
    scores.coordinatedBuys = 90;
    evidence.push(`${coordinated.count} wallets bought within same block — likely coordinated`);
  } else if (coordinated.count > 2) {
    scores.coordinatedBuys = 50;
    evidence.push(`${coordinated.count} near-simultaneous buys detected`);
  } else {
    scores.coordinatedBuys = 10;
    evidence.push('No coordinated buy patterns detected');
  }

  // 2b. Wash Trading Detection
  // Circular transactions: A -> B -> C -> A
  const washTrades = detectWashTrading(transactions);
  if (washTrades.detected) {
    scores.washTrading = 85;
    evidence.push(`Wash trading detected: ${washTrades.cycles} circular transaction chains found`);
    washTrades.examples.forEach(ex => evidence.push(`  Cycle: ${ex}`));
  } else {
    scores.washTrading = 5;
    evidence.push('No wash trading patterns detected');
  }

  // 2c. Sniper Wallet Detection
  // Wallets that bought within first 2 blocks of launch
  const snipers = detectSniperWallets(transactions, tokenData.launchTimestamp);
  if (snipers.count > 3) {
    scores.sniperWallets = 80;
    evidence.push(`${snipers.count} sniper wallets detected (bought within first 2 blocks)`);
    evidence.push(`  Snipers hold ${snipers.totalPercentHeld.toFixed(1)}% of supply`);
  } else if (snipers.count > 0) {
    scores.sniperWallets = 40;
    evidence.push(`${snipers.count} sniper wallet(s) detected`);
  } else {
    scores.sniperWallets = 5;
    evidence.push('No sniper wallets detected');
  }

  // 2d. MEV / Sandwich Attack Detection (GAP #4)
  const mev = detectMevSandwich(transactions);
  if (mev.sandwichCount > 0) {
    scores.mevSandwich = 70 + Math.min(mev.sandwichCount * 5, 25);
    evidence.push(`${mev.sandwichCount} sandwich attacks detected on this token's transactions`);
    evidence.push(`  Total extracted: ~${mev.totalExtractedSol.toFixed(2)} SOL`);
    if (mev.suspectedBots.length > 0) {
      evidence.push(`  Suspected MEV bots: ${mev.suspectedBots.slice(0, 3).map(b => b.slice(0, 8) + '...').join(', ')}`);
    }
  } else {
    scores.mevSandwich = 5;
    evidence.push('No MEV/sandwich attacks detected');
  }

  // 2e. Volume Anomaly
  const volumeAnomaly = detectVolumeAnomaly(transactions, tokenData);
  if (volumeAnomaly.suspicious) {
    scores.volumeAnomaly = volumeAnomaly.score;
    evidence.push(volumeAnomaly.reason);
  } else {
    scores.volumeAnomaly = 10;
    evidence.push('Volume patterns appear organic');
  }

  const layerScore = (
    scores.coordinatedBuys * WEIGHTS.layer2.coordinatedBuys +
    scores.washTrading * WEIGHTS.layer2.washTrading +
    scores.sniperWallets * WEIGHTS.layer2.sniperWallets +
    scores.mevSandwich * WEIGHTS.layer2.mevSandwich +
    scores.volumeAnomaly * WEIGHTS.layer2.volumeAnomaly
  );

  return { score: layerScore, scores, evidence };
}

// ============================================================
// LAYER 3: METADATA FORENSICS
// ============================================================
async function analyzeMetadata(tokenData, deployerData) {
  const evidence = [];
  const scores = {};

  // 3a. Website Quality
  // Check for copied templates, placeholder text, broken links
  const website = tokenData.website || null;
  if (!website) {
    scores.websiteQuality = 60;
    evidence.push('No website found for this token');
  } else {
    const websiteAnalysis = await analyzeWebsite(website);
    scores.websiteQuality = websiteAnalysis.riskScore;
    evidence.push(...websiteAnalysis.findings);
  }

  // 3b. Social Media Presence
  const socials = tokenData.socials || {};
  const socialScore = analyzeSocialPresence(socials);
  scores.socialPresence = socialScore.score;
  evidence.push(...socialScore.findings);

  // 3c. Deployer Wallet History (CRITICAL)
  const deployerHistory = deployerData.history || {};
  if (deployerHistory.previousRugs > 0) {
    scores.deployerHistory = 95;
    evidence.push(`CRITICAL: Deployer wallet has ${deployerHistory.previousRugs} previous rug(s)`);
    if (deployerHistory.ruggedTokens) {
      deployerHistory.ruggedTokens.forEach(t => {
        evidence.push(`  Previous rug: ${t.name} (${t.date}) — ${t.lossAmount}`);
      });
    }
  } else if (deployerHistory.previousTokens > 5) {
    scores.deployerHistory = 65;
    evidence.push(`Deployer has launched ${deployerHistory.previousTokens} tokens — serial launcher`);
  } else if (deployerHistory.walletAge < 7) {
    scores.deployerHistory = 70;
    evidence.push(`Deployer wallet is only ${deployerHistory.walletAge} days old — fresh wallet`);
  } else {
    scores.deployerHistory = 15;
    evidence.push(`Deployer wallet: ${deployerHistory.walletAge} days old, ${deployerHistory.previousTokens || 0} previous tokens, no known rugs`);
  }

  // 3d. Code Originality
  // Is the token contract a known fork/copy?
  const codeAnalysis = tokenData.codeAnalysis || {};
  if (codeAnalysis.isKnownTemplate) {
    scores.codeOriginality = 50;
    evidence.push(`Token uses known template: ${codeAnalysis.templateName || 'standard pump.fun template'}`);
  } else if (codeAnalysis.isForked) {
    scores.codeOriginality = 40;
    evidence.push(`Token code appears forked from: ${codeAnalysis.forkedFrom || 'unknown source'}`);
  } else {
    scores.codeOriginality = 15;
    evidence.push('Token code appears original or uses standard SPL token');
  }

  // 3e. Audit Status
  if (tokenData.audited && tokenData.auditor) {
    // Verify the audit is real
    if (isKnownFakeAuditor(tokenData.auditor)) {
      scores.auditStatus = 80;
      evidence.push(`FAKE AUDIT BADGE: Claims audit by "${tokenData.auditor}" — known fake`);
    } else {
      scores.auditStatus = 10;
      evidence.push(`Audited by ${tokenData.auditor}`);
    }
  } else {
    scores.auditStatus = 45;
    evidence.push('No audit found (common for new launches)');
  }

  const layerScore = (
    scores.websiteQuality * WEIGHTS.layer3.websiteQuality +
    scores.socialPresence * WEIGHTS.layer3.socialPresence +
    scores.deployerHistory * WEIGHTS.layer3.deployerHistory +
    scores.codeOriginality * WEIGHTS.layer3.codeOriginality +
    scores.auditStatus * WEIGHTS.layer3.auditStatus
  );

  return { score: layerScore, scores, evidence };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Gini Coefficient: measures inequality in token distribution
 * 0 = perfect equality, 1 = one wallet holds everything
 */
function calculateGiniCoefficient(balances) {
  if (!balances || balances.length === 0) return 0;
  
  const sorted = [...balances].sort((a, b) => a - b);
  const n = sorted.length;
  const totalSum = sorted.reduce((a, b) => a + b, 0);
  
  if (totalSum === 0) return 0;
  
  let numerator = 0;
  sorted.forEach((val, i) => {
    numerator += (2 * (i + 1) - n - 1) * val;
  });
  
  return numerator / (n * totalSum);
}

/**
 * Detect coordinated buys (multiple wallets in same block)
 */
function detectCoordinatedBuys(transactions) {
  const buysByBlock = {};
  
  transactions.forEach(tx => {
    if (tx.type === 'buy') {
      const block = tx.slot || tx.blockNumber || 0;
      if (!buysByBlock[block]) buysByBlock[block] = [];
      buysByBlock[block].push(tx.wallet);
    }
  });
  
  let maxCoordinated = 0;
  for (const wallets of Object.values(buysByBlock)) {
    if (wallets.length > maxCoordinated) {
      maxCoordinated = wallets.length;
    }
  }
  
  return { count: maxCoordinated };
}

/**
 * Detect wash trading (circular fund flow)
 */
function detectWashTrading(transactions) {
  const graph = {};
  
  transactions.forEach(tx => {
    if (!graph[tx.from]) graph[tx.from] = new Set();
    if (tx.to) graph[tx.from].add(tx.to);
  });
  
  let cycles = 0;
  const examples = [];
  
  // Simple cycle detection: A -> B -> A
  for (const [wallet, targets] of Object.entries(graph)) {
    for (const target of targets) {
      if (graph[target]?.has(wallet)) {
        cycles++;
        if (examples.length < 3) {
          examples.push(`${wallet.slice(0, 8)}... -> ${target.slice(0, 8)}... -> ${wallet.slice(0, 8)}...`);
        }
      }
    }
  }
  
  return {
    detected: cycles > 0,
    cycles: Math.floor(cycles / 2), // Each cycle counted twice
    examples,
  };
}

/**
 * Detect sniper wallets (bought within first N blocks)
 */
function detectSniperWallets(transactions, launchTimestamp) {
  const SNIPE_WINDOW_MS = 12_000; // ~2 Solana blocks (400ms per slot * 30)
  
  const snipers = transactions.filter(tx => 
    tx.type === 'buy' && 
    tx.timestamp && 
    launchTimestamp &&
    (tx.timestamp - launchTimestamp) < SNIPE_WINDOW_MS
  );
  
  const totalHeld = snipers.reduce((sum, tx) => sum + (tx.percentOfSupply || 0), 0);
  
  return {
    count: snipers.length,
    wallets: snipers.map(s => s.wallet),
    totalPercentHeld: totalHeld,
  };
}

/**
 * Detect MEV / Sandwich attacks (GAP #4)
 * Pattern: Bot buys before victim, victim buys (price up), bot sells after
 */
function detectMevSandwich(transactions) {
  const sandwiches = [];
  const suspectedBots = new Set();
  let totalExtracted = 0;
  
  // Sort by timestamp/slot
  const sorted = [...transactions].sort((a, b) => (a.slot || 0) - (b.slot || 0));
  
  for (let i = 0; i < sorted.length - 2; i++) {
    const tx1 = sorted[i];
    const tx2 = sorted[i + 1];
    const tx3 = sorted[i + 2];
    
    // Pattern: buy -> buy -> sell, where tx1.wallet === tx3.wallet
    if (
      tx1.type === 'buy' &&
      tx2.type === 'buy' &&
      tx3.type === 'sell' &&
      tx1.wallet === tx3.wallet &&
      tx1.wallet !== tx2.wallet &&
      // Same block or adjacent blocks
      Math.abs((tx1.slot || 0) - (tx3.slot || 0)) <= 2
    ) {
      sandwiches.push({
        bot: tx1.wallet,
        victim: tx2.wallet,
        frontrunTx: tx1.signature,
        victimTx: tx2.signature,
        backrunTx: tx3.signature,
      });
      suspectedBots.add(tx1.wallet);
      
      // Estimate extracted value
      const buyAmount = tx1.amountSol || 0;
      const sellAmount = tx3.amountSol || 0;
      totalExtracted += Math.max(0, sellAmount - buyAmount);
    }
  }
  
  return {
    sandwichCount: sandwiches.length,
    suspectedBots: [...suspectedBots],
    totalExtractedSol: totalExtracted,
    details: sandwiches.slice(0, 5), // Cap at 5 examples
  };
}

/**
 * Detect volume anomalies
 */
function detectVolumeAnomaly(transactions, tokenData) {
  const buyVolume = transactions
    .filter(t => t.type === 'buy')
    .reduce((sum, t) => sum + (t.amountSol || 0), 0);
  
  const sellVolume = transactions
    .filter(t => t.type === 'sell')
    .reduce((sum, t) => sum + (t.amountSol || 0), 0);
  
  // Extreme buy/sell imbalance
  if (buyVolume > 0 && sellVolume / buyVolume < 0.05) {
    return {
      suspicious: true,
      score: 70,
      reason: `Volume anomaly: ${(sellVolume / buyVolume * 100).toFixed(1)}% sell ratio — almost no one is selling`,
    };
  }
  
  // Suspiciously round numbers in transactions
  const roundTxCount = transactions.filter(t => {
    const amount = t.amountSol || 0;
    return amount > 0 && amount === Math.round(amount);
  }).length;
  
  if (roundTxCount / transactions.length > 0.5) {
    return {
      suspicious: true,
      score: 55,
      reason: `${((roundTxCount / transactions.length) * 100).toFixed(0)}% of transactions are round numbers — possible bot activity`,
    };
  }
  
  return { suspicious: false };
}

/**
 * Analyze website for red flags
 */
async function analyzeWebsite(url) {
  // This would use the Agent Browser skill in production
  // For now, return structure with common checks
  return {
    riskScore: 40,
    findings: [`Website found: ${url} — manual review needed via browser skill`],
  };
}

/**
 * Analyze social media presence
 */
function analyzeSocialPresence(socials) {
  const findings = [];
  let score = 50; // Neutral starting point

  if (!socials.twitter && !socials.telegram && !socials.discord) {
    score = 70;
    findings.push('No social media accounts linked');
  } else {
    if (socials.twitter) {
      score -= 15;
      findings.push(`Twitter: ${socials.twitter}`);
    }
    if (socials.telegram) {
      score -= 10;
      findings.push(`Telegram: ${socials.telegram}`);
    }
    if (socials.discord) {
      score -= 10;
      findings.push(`Discord: ${socials.discord}`);
    }
  }

  return { score: Math.max(5, score), findings };
}

/**
 * Check if auditor name is a known fake
 */
function isKnownFakeAuditor(auditor) {
  const fakeAuditors = [
    'safuaudit', 'tokensafe', 'cryptoaudit', 'auditpro',
    'defiaudit', 'solanaaudit', 'safemoon audit',
  ];
  return fakeAuditors.some(fake => 
    auditor.toLowerCase().replace(/\s+/g, '').includes(fake)
  );
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

/**
 * Score a token across all three layers.
 * 
 * @param {Object} tokenData - Token metadata (from chain monitor + enrichment)
 * @param {Array} transactions - Recent transactions for this token
 * @param {Object} deployerData - Deployer wallet history (from Neo4j or fresh lookup)
 * @param {Connection} connection - Solana RPC connection
 * @returns {Object} Full risk assessment
 */
export async function scoreToken(tokenData, transactions = [], deployerData = {}, connection = null) {
  console.log(`[ScoringEngine] Scoring token: ${tokenData.mint || 'unknown'}`);
  
  const startTime = Date.now();
  
  // Run all three layers
  const [layer1, layer2, layer3] = await Promise.all([
    analyzeTokenVitals(tokenData, connection),
    analyzeBehavior(tokenData, transactions, connection),
    analyzeMetadata(tokenData, deployerData),
  ]);
  
  // Calculate composite score
  const compositeScore = Math.round(
    layer1.score * WEIGHTS.layer1.total +
    layer2.score * WEIGHTS.layer2.total +
    layer3.score * WEIGHTS.layer3.total
  );
  
  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, compositeScore));
  const tier = getConfidenceTier(finalScore);
  
  // Compile all evidence
  const allEvidence = [
    ...layer1.evidence.map(e => `[L1] ${e}`),
    ...layer2.evidence.map(e => `[L2] ${e}`),
    ...layer3.evidence.map(e => `[L3] ${e}`),
  ];
  
  const result = {
    tokenMint: tokenData.mint || null,
    tokenName: tokenData.name || 'Unknown',
    riskScore: finalScore,
    confidenceTier: tier,
    timestamp: Date.now(),
    analysisTimeMs: Date.now() - startTime,
    
    breakdown: {
      layer1_tokenVitals: {
        score: Math.round(layer1.score),
        weight: WEIGHTS.layer1.total,
        details: layer1.scores,
      },
      layer2_behavioral: {
        score: Math.round(layer2.score),
        weight: WEIGHTS.layer2.total,
        details: layer2.scores,
      },
      layer3_metadata: {
        score: Math.round(layer3.score),
        weight: WEIGHTS.layer3.total,
        details: layer3.scores,
      },
    },
    
    evidence: allEvidence,
    
    // Action recommendation based on tier
    recommendation: getRecommendation(tier, finalScore),
  };
  
  console.log(`[ScoringEngine] ${tokenData.name || tokenData.mint}: Score=${finalScore} Tier=${tier} (${Date.now() - startTime}ms)`);
  
  return result;
}

function getRecommendation(tier, score) {
  switch (tier) {
    case 'CONFIRMED':
      return { action: 'POST_MORTEM', priority: 'P0', publish: true };
    case 'HIGH_PROBABILITY':
      return { action: 'FULL_INVESTIGATION', priority: 'P1', publish: true };
    case 'RED_FLAGS':
      return { action: 'CAUTION_THREAD', priority: 'P2', publish: true };
    case 'OBSERVATION':
      return { action: 'WATCHLIST', priority: 'P3', publish: score >= 50 };
    default:
      return { action: 'LOG_ONLY', priority: 'P4', publish: false };
  }
}

export default { scoreToken, getConfidenceTier, calculateGiniCoefficient };
