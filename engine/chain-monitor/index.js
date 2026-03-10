/**
 * SENTINEL — Chain Monitor
 * =========================
 * Helius webhook listener for Solana token launches and liquidity events.
 * Filters noise, rotates through fallback RPCs, and feeds the scoring pipeline.
 * 
 * This is an OpenClaw custom skill. It exposes functions that the
 * HEARTBEAT loop calls every 60 seconds.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  helius: {
    apiKey: process.env.HELIUS_API_KEY,
    webhookUrl: process.env.HELIUS_WEBHOOK_URL || 'http://localhost:3001/webhook/helius',
    rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
  },
  fallbackRpcs: [
    { name: 'helius_rpc', url: `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` },
    { name: 'quicknode', url: process.env.QUICKNODE_RPC_URL || '' },
    { name: 'public', url: 'https://api.mainnet-beta.solana.com' },
  ],
  noiseFilter: {
    minLiquidityUsd: 10_000,
    maxNewInvestigationsPerHour: 10,
    deduplicationWindowMs: 300_000, // 5 minutes
  },
  webhookPort: parseInt(process.env.WEBHOOK_PORT || '3001'),
};

// ============================================================
// KNOWN LEGIT TOKENS WHITELIST
// ============================================================
const WHITELIST = new Set([
  'So11111111111111111111111111111111111111112',   // SOL (Wrapped)
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  // JUP
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  // RENDER
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux',  // HNT
]);

// ============================================================
// STATE
// ============================================================
let currentRpcIndex = 0;
let connection = null;
let eventQueue = [];
let processedEvents = new Map(); // deduplication: eventHash -> timestamp
let investigationsThisHour = 0;
let hourlyResetTimer = null;

// ============================================================
// RPC CONNECTION WITH FALLBACK
// ============================================================
function getConnection() {
  if (connection) return connection;
  return rotateRpc();
}

function rotateRpc() {
  const rpcs = CONFIG.fallbackRpcs.filter(r => r.url);
  if (rpcs.length === 0) {
    throw new Error('No RPC endpoints configured');
  }
  
  const rpc = rpcs[currentRpcIndex % rpcs.length];
  connection = new Connection(rpc.url, 'confirmed');
  
  console.log(`[ChainMonitor] Connected to RPC: ${rpc.name}`);
  return connection;
}

function handleRpcFailure(error) {
  console.error(`[ChainMonitor] RPC failed: ${error.message}`);
  currentRpcIndex++;
  connection = null;
  
  const rpcs = CONFIG.fallbackRpcs.filter(r => r.url);
  const newRpc = rpcs[currentRpcIndex % rpcs.length];
  
  return {
    alert: {
      level: currentRpcIndex >= rpcs.length ? 'P0' : 'P1',
      message: currentRpcIndex >= rpcs.length 
        ? `All RPC endpoints failed. Last error: ${error.message}`
        : `RPC failover to ${newRpc.name}. Error: ${error.message}`,
    },
    connection: rotateRpc(),
  };
}

// ============================================================
// WEBHOOK LISTENER (Primary data source)
// ============================================================
function createWebhookServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Helius Enhanced Transactions webhook
  app.post('/webhook/helius', (req, res) => {
    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];
      
      for (const event of events) {
        const processed = parseHeliusEvent(event);
        if (processed && passesNoiseFilter(processed)) {
          enqueueEvent(processed);
        }
      }
      
      res.status(200).json({ received: events.length });
    } catch (error) {
      console.error('[ChainMonitor] Webhook parse error:', error);
      res.status(500).json({ error: 'Parse failed' });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      chain_monitor: {
        source: getCurrentSourceName(),
        queue_depth: eventQueue.length,
        investigations_this_hour: investigationsThisHour,
        rpc_index: currentRpcIndex,
      }
    });
  });

  app.listen(CONFIG.webhookPort, () => {
    console.log(`[ChainMonitor] Webhook listener on port ${CONFIG.webhookPort}`);
  });

  return app;
}

// ============================================================
// EVENT PARSING
// ============================================================
function parseHeliusEvent(event) {
  if (!event || !event.type) return null;

  const baseEvent = {
    raw: event,
    timestamp: event.timestamp ? event.timestamp * 1000 : Date.now(),
    signature: event.signature || null,
  };

  // Token creation events
  if (event.type === 'TOKEN_MINT' || event.type === 'CREATE') {
    return {
      ...baseEvent,
      eventType: 'TOKEN_LAUNCH',
      tokenMint: event.tokenTransfers?.[0]?.mint || event.accounts?.[0] || null,
      deployerWallet: event.feePayer || null,
      metadata: {
        name: event.description || 'Unknown',
        source: event.source || 'unknown',
      },
    };
  }

  // Liquidity addition events (Raydium, Orca, pump.fun)
  if (event.type === 'SWAP' || event.type === 'ADD_LIQUIDITY') {
    const solAmount = event.nativeTransfers?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
    const solValue = solAmount / 1e9; // lamports to SOL
    
    return {
      ...baseEvent,
      eventType: 'LIQUIDITY_ADD',
      tokenMint: event.tokenTransfers?.[0]?.mint || null,
      deployerWallet: event.feePayer || null,
      liquiditySol: solValue,
      liquidityUsd: null, // Will be enriched by scoring engine
      poolAddress: event.accounts?.[0] || null,
      source: event.source || 'unknown',
    };
  }

  // Large liquidity removal events
  if (event.type === 'REMOVE_LIQUIDITY') {
    const solAmount = event.nativeTransfers?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0;
    const solValue = solAmount / 1e9;
    
    return {
      ...baseEvent,
      eventType: 'LIQUIDITY_REMOVE',
      tokenMint: event.tokenTransfers?.[0]?.mint || null,
      deployerWallet: event.feePayer || null,
      liquiditySol: solValue,
      liquidityUsd: null,
      poolAddress: event.accounts?.[0] || null,
      source: event.source || 'unknown',
      // Liquidity removal is always interesting — potential rug signal
      priority: solValue > 50 ? 'P0' : 'P1',
    };
  }

  return null;
}

// ============================================================
// NOISE FILTER
// ============================================================
function passesNoiseFilter(event) {
  // Skip whitelisted tokens
  if (event.tokenMint && WHITELIST.has(event.tokenMint)) {
    return false;
  }

  // Deduplication check
  const eventHash = `${event.eventType}:${event.tokenMint}:${event.signature}`;
  const lastSeen = processedEvents.get(eventHash);
  if (lastSeen && (Date.now() - lastSeen) < CONFIG.noiseFilter.deduplicationWindowMs) {
    return false;
  }
  processedEvents.set(eventHash, Date.now());

  // Rate limit: max investigations per hour
  if (investigationsThisHour >= CONFIG.noiseFilter.maxNewInvestigationsPerHour) {
    // Still allow P0 priority events (active rug signals)
    if (event.priority !== 'P0') {
      console.log(`[ChainMonitor] Rate limited: ${investigationsThisHour} investigations this hour`);
      return false;
    }
  }

  // Liquidity removal events always pass (potential rug signal)
  if (event.eventType === 'LIQUIDITY_REMOVE') {
    return true;
  }

  return true;
}

// ============================================================
// EVENT QUEUE
// ============================================================
function enqueueEvent(event) {
  // Assign priority if not already set
  if (!event.priority) {
    if (event.eventType === 'LIQUIDITY_REMOVE' && event.liquiditySol > 50) {
      event.priority = 'P0'; // Large liquidity removal = potential active rug
    } else if (event.eventType === 'LIQUIDITY_REMOVE') {
      event.priority = 'P1';
    } else if (event.eventType === 'TOKEN_LAUNCH') {
      event.priority = 'P3'; // New launches start as medium priority
    } else {
      event.priority = 'P4';
    }
  }

  eventQueue.push(event);
  
  // Sort by priority (P0 first)
  eventQueue.sort((a, b) => {
    const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
    return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
  });

  // Cap queue size
  if (eventQueue.length > 50) {
    const dropped = eventQueue.splice(50);
    console.log(`[ChainMonitor] Queue overflow: dropped ${dropped.length} lowest-priority events`);
  }

  investigationsThisHour++;
  console.log(`[ChainMonitor] Queued: ${event.eventType} | Token: ${event.tokenMint?.slice(0, 8)}... | Priority: ${event.priority} | Queue: ${eventQueue.length}`);
}

// ============================================================
// RPC POLLING (Fallback when webhooks fail)
// ============================================================
async function pollRecentTransactions() {
  try {
    const conn = getConnection();
    
    // Get recent signatures for known DEX programs
    const RAYDIUM_AMM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
    const signatures = await conn.getSignaturesForAddress(RAYDIUM_AMM, { limit: 20 });
    
    const newEvents = [];
    for (const sig of signatures) {
      const eventHash = `poll:${sig.signature}`;
      if (processedEvents.has(eventHash)) continue;
      processedEvents.set(eventHash, Date.now());
      
      try {
        const tx = await conn.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        
        if (tx) {
          const event = parseRpcTransaction(tx, sig.signature);
          if (event && passesNoiseFilter(event)) {
            newEvents.push(event);
          }
        }
      } catch (txError) {
        // Individual tx parse failure is non-fatal
        continue;
      }
    }
    
    return newEvents;
  } catch (error) {
    const fallbackResult = handleRpcFailure(error);
    return { error: fallbackResult.alert };
  }
}

function parseRpcTransaction(tx, signature) {
  if (!tx?.meta || tx.meta.err) return null;
  
  const preBalances = tx.meta.preTokenBalances || [];
  const postBalances = tx.meta.postTokenBalances || [];
  
  // Detect new token accounts (potential launch/LP add)
  const newMints = postBalances
    .filter(post => !preBalances.find(pre => pre.mint === post.mint && pre.owner === post.owner))
    .map(b => b.mint);
  
  if (newMints.length > 0) {
    return {
      eventType: 'TOKEN_LAUNCH',
      tokenMint: newMints[0],
      deployerWallet: tx.transaction.message.accountKeys[0]?.pubkey?.toString(),
      signature: signature,
      timestamp: (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000,
      metadata: { source: 'rpc_poll' },
    };
  }
  
  return null;
}

// ============================================================
// DEDUPLICATION CLEANUP
// ============================================================
function cleanupProcessedEvents() {
  const cutoff = Date.now() - CONFIG.noiseFilter.deduplicationWindowMs * 2;
  let cleaned = 0;
  for (const [hash, timestamp] of processedEvents) {
    if (timestamp < cutoff) {
      processedEvents.delete(hash);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[ChainMonitor] Cleaned ${cleaned} expired event hashes`);
  }
}

// ============================================================
// PUBLIC API (Called by HEARTBEAT loop)
// ============================================================
export function getSourceName() {
  return getCurrentSourceName();
}

function getCurrentSourceName() {
  const rpcs = CONFIG.fallbackRpcs.filter(r => r.url);
  if (rpcs.length === 0) return 'none';
  return rpcs[currentRpcIndex % rpcs.length].name;
}

/**
 * Called every heartbeat cycle (60s).
 * Returns new events for the scoring pipeline.
 */
export async function poll() {
  // Clean up old dedup entries
  cleanupProcessedEvents();
  
  // If webhook server is running, events auto-queue via POST
  // This poll function handles the RPC fallback path
  if (eventQueue.length === 0) {
    // No webhook events — try RPC polling as fallback
    const rpcEvents = await pollRecentTransactions();
    
    if (rpcEvents?.error) {
      return { events: [], alert: rpcEvents.error };
    }
    
    if (Array.isArray(rpcEvents)) {
      rpcEvents.forEach(e => enqueueEvent(e));
    }
  }
  
  // Return queued events (scoring engine processes them)
  const events = [...eventQueue];
  eventQueue = [];
  
  return {
    events,
    source: getCurrentSourceName(),
    queueDepthBefore: events.length,
  };
}

/**
 * Initialize the chain monitor.
 * Starts webhook server and sets up hourly rate limit reset.
 */
export function init() {
  console.log('[ChainMonitor] Initializing...');
  
  // Start webhook listener
  createWebhookServer();
  
  // Reset hourly investigation counter
  hourlyResetTimer = setInterval(() => {
    investigationsThisHour = 0;
  }, 3600_000);
  
  console.log('[ChainMonitor] Ready. Listening for Solana events.');
  
  return {
    status: 'ok',
    source: getCurrentSourceName(),
    webhookPort: CONFIG.webhookPort,
  };
}

/**
 * Graceful shutdown
 */
export function shutdown() {
  if (hourlyResetTimer) clearInterval(hourlyResetTimer);
  connection = null;
  console.log('[ChainMonitor] Shut down.');
}

export default { init, poll, shutdown, getSourceName };
