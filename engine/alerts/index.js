/**
 * SENTINEL — Alert System
 * ========================
 * Real-time Telegram notifications with priority levels.
 * Also handles the Phase 0.5 human-in-the-loop approval queue.
 * 
 * Alert Levels:
 *   P0 (CRITICAL)  — Confirmed rug in progress, system crash
 *   P1 (URGENT)    — High-risk token (score >85), health warning
 *   P2 (INFO)      — Investigation queued, content posted, milestones
 * 
 * Uses OpenClaw's native Telegram adapter or direct Bot API.
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    apiUrl: 'https://api.telegram.org/bot',
  },
  humanInLoop: {
    enabled: process.env.HUMAN_IN_LOOP === 'true',
    timeoutMinutes: parseInt(process.env.APPROVAL_TIMEOUT_MINUTES || '60'),
  },
  rateLimits: {
    maxAlertsPerHour: { P0: 50, P1: 20, P2: 10 },
    cooldownMs: { P0: 0, P1: 30000, P2: 300000 }, // 0s, 30s, 5min
  },
};

// ============================================================
// STATE
// ============================================================
const alertCounts = { P0: 0, P1: 0, P2: 0 };
const lastAlertTime = { P0: 0, P1: 0, P2: 0 };
let hourlyResetTimer = null;
const pendingApprovals = new Map(); // messageId -> { content, callback, timestamp }

// ============================================================
// CORE ALERT FUNCTIONS
// ============================================================

/**
 * Send a P0 critical alert. No rate limiting — these always go through.
 */
export async function alertCritical(title, details, data = {}) {
  const message = formatAlert('P0', 'CRITICAL', title, details, data);
  return sendTelegramMessage(message, { priority: 'P0', parse_mode: 'HTML' });
}

/**
 * Send a P1 urgent alert. Rate limited to prevent spam.
 */
export async function alertUrgent(title, details, data = {}) {
  if (!checkRateLimit('P1')) {
    console.log(`[Alerts] P1 rate limited: ${title}`);
    return { sent: false, reason: 'rate_limited' };
  }
  const message = formatAlert('P1', 'URGENT', title, details, data);
  return sendTelegramMessage(message, { priority: 'P1', parse_mode: 'HTML' });
}

/**
 * Send a P2 info alert. Most aggressively rate limited.
 */
export async function alertInfo(title, details, data = {}) {
  if (!checkRateLimit('P2')) {
    return { sent: false, reason: 'rate_limited' };
  }
  const message = formatAlert('P2', 'INFO', title, details, data);
  return sendTelegramMessage(message, { priority: 'P2', parse_mode: 'HTML' });
}

// ============================================================
// ALERT FORMATTING
// ============================================================

function formatAlert(level, label, title, details, data) {
  const icons = { P0: '🚨', P1: '⚠️', P2: 'ℹ️' };
  const icon = icons[level] || '📋';
  
  let message = `${icon} <b>[${label}] ${title}</b>\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (typeof details === 'string') {
    message += `${details}\n`;
  } else if (Array.isArray(details)) {
    details.forEach(d => { message += `• ${d}\n`; });
  }

  // Add structured data if present
  if (data.tokenMint) {
    message += `\n<b>Token:</b> <code>${data.tokenMint}</code>`;
  }
  if (data.riskScore !== undefined) {
    message += `\n<b>Risk Score:</b> ${data.riskScore}/100 (${data.confidenceTier || 'N/A'})`;
  }
  if (data.deployerWallet) {
    message += `\n<b>Deployer:</b> <code>${data.deployerWallet.slice(0, 8)}...${data.deployerWallet.slice(-4)}</code>`;
  }
  if (data.evidence && data.evidence.length > 0) {
    message += `\n\n<b>Key Evidence:</b>`;
    data.evidence.slice(0, 5).forEach(e => {
      message += `\n• ${e}`;
    });
    if (data.evidence.length > 5) {
      message += `\n  <i>...and ${data.evidence.length - 5} more findings</i>`;
    }
  }
  if (data.url) {
    message += `\n\n🔗 ${data.url}`;
  }

  message += `\n\n<i>${new Date().toISOString()}</i>`;
  
  return message;
}

// ============================================================
// HUMAN-IN-THE-LOOP APPROVAL QUEUE
// ============================================================

/**
 * Submit content for human approval before posting.
 * Used during Phase 0.5 supervised mode.
 * 
 * @param {string} content - The tweet or thread to approve
 * @param {Object} metadata - Investigation data, risk score, etc.
 * @returns {Promise<Object>} Approval result
 */
export async function requestApproval(content, metadata = {}) {
  if (!CONFIG.humanInLoop.enabled) {
    // Auto-approve if human-in-loop is disabled
    return { approved: true, autoApproved: true };
  }

  const message = formatApprovalRequest(content, metadata);
  const result = await sendTelegramMessage(message, {
    parse_mode: 'HTML',
    reply_markup: JSON.stringify({
      inline_keyboard: [
        [
          { text: 'APPROVE', callback_data: 'approve' },
          { text: 'REJECT', callback_data: 'reject' },
        ],
        [
          { text: 'EDIT & APPROVE', callback_data: 'edit' },
        ],
      ],
    }),
  });

  if (!result.sent) {
    console.error('[Alerts] Failed to send approval request');
    return { approved: false, error: 'send_failed' };
  }

  // Store pending approval
  const approvalId = result.messageId || Date.now().toString();
  
  return new Promise((resolve) => {
    pendingApprovals.set(approvalId, {
      content,
      metadata,
      timestamp: Date.now(),
      resolve,
    });

    // Timeout — auto-skip (don't post) if no response
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        console.log(`[Alerts] Approval timed out for: ${content.slice(0, 50)}...`);
        resolve({ approved: false, reason: 'timeout' });
      }
    }, CONFIG.humanInLoop.timeoutMinutes * 60 * 1000);
  });
}

function formatApprovalRequest(content, metadata) {
  let message = `📝 <b>APPROVAL REQUIRED</b>\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  if (metadata.contentType) {
    message += `<b>Type:</b> ${metadata.contentType}\n`;
  }
  if (metadata.riskScore !== undefined) {
    message += `<b>Risk Score:</b> ${metadata.riskScore}/100\n`;
  }
  if (metadata.confidenceTier) {
    message += `<b>Tier:</b> ${metadata.confidenceTier}\n`;
  }
  
  message += `\n<b>Content to post:</b>\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  
  // Format the tweet content
  if (Array.isArray(content)) {
    // Thread
    content.forEach((tweet, i) => {
      message += `\n<b>${i + 1}/</b> ${escapeHtml(tweet)}\n`;
    });
  } else {
    message += `\n${escapeHtml(content)}\n`;
  }
  
  message += `\n━━━━━━━━━━━━━━━━━━━━━`;
  message += `\n<i>Reply within ${CONFIG.humanInLoop.timeoutMinutes}min or auto-skip</i>`;
  
  return message;
}

/**
 * Handle callback from Telegram inline buttons.
 * Called by the webhook handler when user taps APPROVE/REJECT.
 */
export function handleApprovalCallback(callbackData, messageId) {
  const pending = pendingApprovals.get(messageId);
  if (!pending) {
    console.log(`[Alerts] No pending approval for message ${messageId}`);
    return false;
  }

  pendingApprovals.delete(messageId);

  switch (callbackData) {
    case 'approve':
      pending.resolve({ approved: true, editedContent: null });
      alertInfo('Content Approved', 'Post queued for publication');
      return true;
    
    case 'reject':
      pending.resolve({ approved: false, reason: 'rejected' });
      alertInfo('Content Rejected', 'Post will not be published');
      return true;
    
    case 'edit':
      // In edit mode, next text message from the user replaces the content
      pending.resolve({ approved: true, awaitingEdit: true });
      return true;
    
    default:
      return false;
  }
}

// ============================================================
// INVESTIGATION ALERTS (Convenience wrappers)
// ============================================================

/**
 * Alert when a new high-risk token is detected
 */
export async function alertNewInvestigation(scoringResult) {
  const level = scoringResult.riskScore >= 95 ? 'P0' :
                scoringResult.riskScore >= 85 ? 'P1' : 'P2';
  
  const title = `${scoringResult.confidenceTier}: ${scoringResult.tokenName || 'Unknown Token'}`;
  
  const details = [
    `Risk Score: ${scoringResult.riskScore}/100`,
    `Layer 1 (Vitals): ${scoringResult.breakdown?.layer1_tokenVitals?.score || 'N/A'}`,
    `Layer 2 (Behavior): ${scoringResult.breakdown?.layer2_behavioral?.score || 'N/A'}`,
    `Layer 3 (Metadata): ${scoringResult.breakdown?.layer3_metadata?.score || 'N/A'}`,
    `Recommendation: ${scoringResult.recommendation?.action || 'N/A'}`,
  ];

  const alertFn = level === 'P0' ? alertCritical : level === 'P1' ? alertUrgent : alertInfo;
  return alertFn(title, details, {
    tokenMint: scoringResult.tokenMint,
    riskScore: scoringResult.riskScore,
    confidenceTier: scoringResult.confidenceTier,
    evidence: scoringResult.evidence?.slice(0, 5),
  });
}

/**
 * Alert when a rug pull is confirmed (liquidity pulled)
 */
export async function alertRugConfirmed(tokenName, details) {
  return alertCritical(`CONFIRMED RUG: ${tokenName}`, details, {
    ...details,
    confidenceTier: 'CONFIRMED',
  });
}

/**
 * Alert for system health issues
 */
export async function alertHealthIssue(component, issue, severity = 'P1') {
  const alertFn = severity === 'P0' ? alertCritical : alertUrgent;
  return alertFn(`Health: ${component}`, issue);
}

/**
 * Send the daily diagnostic summary
 */
export async function sendDailyDiagnostic(metrics) {
  const message = `
📊 <b>SENTINEL DAILY DIAGNOSTIC</b> — ${new Date().toLocaleDateString()}
━━━━━━━━━━━━━━━━━━━━━━━━━
<b>Uptime:</b> ${metrics.uptime || 'N/A'}
<b>Investigations:</b> ${metrics.investigationsCompleted || 0} completed, ${metrics.investigationsQueued || 0} queued
<b>Posts:</b> ${metrics.postsPublished || 0} published, ${metrics.postsRejected || 0} rejected
<b>Tokens flagged:</b> ${metrics.tokensFlagged || 0} (${metrics.confirmedRugs || 0} confirmed)
<b>Neo4j:</b> ${metrics.neo4jNodes || 0} nodes, ${metrics.neo4jEdges || 0} edges
<b>Model:</b> ${metrics.modelName || 'N/A'}
<b>Chain source:</b> ${metrics.chainSource || 'N/A'}
<b>Errors:</b> ${metrics.errorsToday || 0}
<b>Memory:</b> ${metrics.memoryMb || 0}MB
<b>Context:</b> ${metrics.contextUsagePct || 0}%
━━━━━━━━━━━━━━━━━━━━━━━━━
<b>STATUS:</b> ${metrics.status || 'UNKNOWN'}
`.trim();

  return sendTelegramMessage(message, { parse_mode: 'HTML' });
}

// ============================================================
// TELEGRAM API
// ============================================================

async function sendTelegramMessage(text, options = {}) {
  const { botToken, chatId, apiUrl } = CONFIG.telegram;
  
  if (!botToken || !chatId) {
    console.error('[Alerts] Telegram not configured (missing BOT_TOKEN or CHAT_ID)');
    return { sent: false, error: 'not_configured' };
  }

  try {
    const url = `${apiUrl}${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text: text.slice(0, 4096), // Telegram message limit
      parse_mode: options.parse_mode || 'HTML',
      disable_web_page_preview: true,
    };
    
    if (options.reply_markup) {
      body.reply_markup = options.reply_markup;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    
    if (data.ok) {
      // Track rate limits
      if (options.priority) {
        alertCounts[options.priority]++;
        lastAlertTime[options.priority] = Date.now();
      }
      
      return { 
        sent: true, 
        messageId: data.result?.message_id?.toString(),
      };
    } else {
      console.error(`[Alerts] Telegram API error: ${data.description}`);
      return { sent: false, error: data.description };
    }
  } catch (error) {
    console.error(`[Alerts] Failed to send Telegram message: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

// ============================================================
// RATE LIMITING
// ============================================================

function checkRateLimit(level) {
  // Check hourly limit
  if (alertCounts[level] >= CONFIG.rateLimits.maxAlertsPerHour[level]) {
    return false;
  }
  
  // Check cooldown
  const timeSinceLast = Date.now() - lastAlertTime[level];
  if (timeSinceLast < CONFIG.rateLimits.cooldownMs[level]) {
    return false;
  }
  
  return true;
}

// ============================================================
// UTILITIES
// ============================================================

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// INITIALIZATION
// ============================================================

export function init() {
  console.log('[Alerts] Initializing...');
  console.log(`[Alerts] Human-in-loop: ${CONFIG.humanInLoop.enabled ? 'ENABLED' : 'DISABLED'}`);
  
  // Reset hourly counters
  hourlyResetTimer = setInterval(() => {
    alertCounts.P0 = 0;
    alertCounts.P1 = 0;
    alertCounts.P2 = 0;
  }, 3600_000);

  // Send startup notification
  alertInfo('Sentinel Online', 'Alert system initialized. Monitoring active.');

  return { status: 'ok', humanInLoop: CONFIG.humanInLoop.enabled };
}

export function shutdown() {
  if (hourlyResetTimer) clearInterval(hourlyResetTimer);
  pendingApprovals.clear();
  console.log('[Alerts] Shut down.');
}

export function getStats() {
  return {
    alertsSent: { ...alertCounts },
    pendingApprovals: pendingApprovals.size,
    humanInLoopEnabled: CONFIG.humanInLoop.enabled,
  };
}

export default {
  init,
  shutdown,
  getStats,
  alertCritical,
  alertUrgent,
  alertInfo,
  alertNewInvestigation,
  alertRugConfirmed,
  alertHealthIssue,
  sendDailyDiagnostic,
  requestApproval,
  handleApprovalCallback,
};
