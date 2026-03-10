/**
 * SENTINEL — Re-Investigation Trigger System
 * ============================================
 * Catches slow rugs that drain over weeks instead of instant pulls.
 * Runs every 6 hours, checks all previously flagged tokens for changes.
 * 
 * Triggers:
 *   - Liquidity dropped >50% since flag
 *   - Top holders dumped >30% of holdings
 *   - Website/socials went dark
 *   - Deployer moved funds to mixer
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  checkIntervalMs: 6 * 3600000, // 6 hours
  thresholds: {
    liquidityDropPercent: 50,
    holderDumpPercent: 30,
    websiteDownDays: 3,
    mixerTransferSol: 10,
  },
  maxTokensPerCheck: 100,
};

// ============================================================
// STATE
// ============================================================
let watchlist = [];
let lastCheckTime = 0;
let checkTimer = null;

// ============================================================
// WATCHLIST MANAGEMENT
// ============================================================

export function addToWatchlist(token) {
  const existing = watchlist.find(t => t.mint === token.mint);
  if (existing) {
    existing.lastScore = token.riskScore;
    existing.lastChecked = Date.now();
    return;
  }
  
  watchlist.push({
    mint: token.mint,
    name: token.name || 'Unknown',
    deployerWallet: token.deployerWallet,
    initialScore: token.riskScore,
    lastScore: token.riskScore,
    initialLiquidity: token.liquidityUsd || 0,
    lastLiquidity: token.liquidityUsd || 0,
    initialTop10Percent: token.top10HolderPercent || 0,
    lastTop10Percent: token.top10HolderPercent || 0,
    websiteUrl: token.website || null,
    websiteLastUp: Date.now(),
    flaggedAt: Date.now(),
    lastChecked: Date.now(),
    status: 'WATCHING',
    triggerHistory: [],
  });
  
  console.log(`[ReInvestigation] Added to watchlist: ${token.name || token.mint} (score: ${token.riskScore})`);
}

export function removeFromWatchlist(mint) {
  watchlist = watchlist.filter(t => t.mint !== mint);
}

export function getWatchlist() {
  return [...watchlist];
}

// ============================================================
// CHECK CYCLE (Runs every 6 hours)
// ============================================================

export async function runCheck() {
  console.log(`[ReInvestigation] Starting watchlist check (${watchlist.length} tokens)`);
  lastCheckTime = Date.now();
  
  const triggers = [];
  const tokensToCheck = watchlist
    .filter(t => t.status !== 'CONFIRMED_RUG' && t.status !== 'CLEARED')
    .slice(0, CONFIG.maxTokensPerCheck);
  
  for (const token of tokensToCheck) {
    try {
      const currentData = await fetchCurrentTokenData(token.mint);
      if (!currentData) continue;
      
      const fired = [];
      
      // CHECK 1: Liquidity drop
      if (token.lastLiquidity > 0 && currentData.liquidityUsd > 0) {
        const dropPercent = ((token.lastLiquidity - currentData.liquidityUsd) / token.lastLiquidity) * 100;
        if (dropPercent >= CONFIG.thresholds.liquidityDropPercent) {
          fired.push({
            type: 'LIQUIDITY_DROP',
            detail: `Liquidity dropped ${dropPercent.toFixed(1)}% (${formatUsd(token.lastLiquidity)} -> ${formatUsd(currentData.liquidityUsd)})`,
            severity: dropPercent >= 90 ? 'CRITICAL' : 'HIGH',
          });
        }
      } else if (token.lastLiquidity > 0 && (!currentData.liquidityUsd || currentData.liquidityUsd === 0)) {
        fired.push({
          type: 'LIQUIDITY_REMOVED',
          detail: `All liquidity removed (was ${formatUsd(token.lastLiquidity)})`,
          severity: 'CRITICAL',
        });
      }
      
      // CHECK 2: Top holder dumping
      if (currentData.top10HolderPercent !== undefined && token.lastTop10Percent > 0) {
        const dumpPercent = token.lastTop10Percent - currentData.top10HolderPercent;
        if (dumpPercent >= CONFIG.thresholds.holderDumpPercent) {
          fired.push({
            type: 'HOLDER_DUMP',
            detail: `Top 10 holders dumped ${dumpPercent.toFixed(1)}% (${token.lastTop10Percent}% -> ${currentData.top10HolderPercent}%)`,
            severity: 'HIGH',
          });
        }
      }
      
      // CHECK 3: Website/socials went dark
      if (token.websiteUrl) {
        const siteUp = await checkWebsiteAlive(token.websiteUrl);
        if (!siteUp) {
          const daysSinceUp = (Date.now() - token.websiteLastUp) / 86400000;
          if (daysSinceUp >= CONFIG.thresholds.websiteDownDays) {
            fired.push({
              type: 'WEBSITE_DARK',
              detail: `Website ${token.websiteUrl} has been down for ${daysSinceUp.toFixed(1)} days`,
              severity: 'MEDIUM',
            });
          }
        } else {
          token.websiteLastUp = Date.now();
        }
      }
      
      // CHECK 4: Deployer moved funds to mixer
      if (token.deployerWallet) {
        const mixerTransfers = await checkMixerTransfers(token.deployerWallet, token.lastChecked);
        if (mixerTransfers.found) {
          fired.push({
            type: 'MIXER_TRANSFER',
            detail: `Deployer moved ${mixerTransfers.amountSol.toFixed(2)} SOL to mixer (${mixerTransfers.mixer})`,
            severity: 'CRITICAL',
          });
        }
      }
      
      // Process triggers
      if (fired.length > 0) {
        const hasCritical = fired.some(f => f.severity === 'CRITICAL');
        
        token.status = hasCritical ? 'CONFIRMED_RUG' : 'RE_INVESTIGATING';
        token.triggerHistory.push({
          timestamp: Date.now(),
          triggers: fired,
        });
        
        triggers.push({
          token: { mint: token.mint, name: token.name },
          triggers: fired,
          newStatus: token.status,
          priority: hasCritical ? 'P0' : 'P1',
        });
        
        console.log(`[ReInvestigation] TRIGGERS FIRED for ${token.name}: ${fired.map(f => f.type).join(', ')}`);
      }
      
      // Update stored data
      token.lastLiquidity = currentData.liquidityUsd || token.lastLiquidity;
      token.lastTop10Percent = currentData.top10HolderPercent || token.lastTop10Percent;
      token.lastChecked = Date.now();
      
    } catch (error) {
      console.error(`[ReInvestigation] Error checking ${token.mint}: ${error.message}`);
    }
  }
  
  console.log(`[ReInvestigation] Check complete: ${triggers.length} tokens triggered out of ${tokensToCheck.length} checked`);
  
  return {
    checked: tokensToCheck.length,
    triggered: triggers.length,
    triggers,
    timestamp: Date.now(),
  };
}

// ============================================================
// DATA FETCHERS (Skill adapters)
// ============================================================

async function fetchCurrentTokenData(mint) {
  // Uses Chain Monitor + Helius API to get current token state
  // In production: calls Helius getAsset or DAS API
  return {
    mint,
    liquidityUsd: 0,
    top10HolderPercent: 0,
    holderCount: 0,
  };
}

async function checkWebsiteAlive(url) {
  // Uses Agent Browser skill to check if site loads
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkMixerTransfers(walletAddress, sinceTimestamp) {
  // Known Solana mixers/tumblers
  const KNOWN_MIXERS = [
    'mixer_placeholder_1',
    'mixer_placeholder_2',
  ];
  
  // In production: query Helius for recent transactions from this wallet
  // Check if any destination is a known mixer
  return { found: false, amountSol: 0, mixer: null };
}

// ============================================================
// UTILITIES
// ============================================================

function formatUsd(amount) {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(2)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

// ============================================================
// LIFECYCLE
// ============================================================

export function init() {
  console.log(`[ReInvestigation] Initializing — check interval: ${CONFIG.checkIntervalMs / 3600000}h`);
  
  // Run check on interval
  checkTimer = setInterval(runCheck, CONFIG.checkIntervalMs);
  
  return { status: 'ok', watchlistSize: watchlist.length };
}

export function shutdown() {
  if (checkTimer) clearInterval(checkTimer);
  console.log('[ReInvestigation] Shut down.');
}

export function getStats() {
  return {
    watchlistSize: watchlist.length,
    lastCheckTime: lastCheckTime > 0 ? new Date(lastCheckTime).toISOString() : null,
    statusBreakdown: {
      watching: watchlist.filter(t => t.status === 'WATCHING').length,
      reInvestigating: watchlist.filter(t => t.status === 'RE_INVESTIGATING').length,
      confirmed: watchlist.filter(t => t.status === 'CONFIRMED_RUG').length,
      cleared: watchlist.filter(t => t.status === 'CLEARED').length,
    },
  };
}

export default { init, shutdown, getStats, addToWatchlist, removeFromWatchlist, getWatchlist, runCheck };
