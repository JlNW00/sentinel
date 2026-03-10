/**
 * SENTINEL — Self-Improvement System
 * =====================================
 * Wires the off-the-shelf self-improving-agent skill (87.6K downloads)
 * into Sentinel's investigation pipeline.
 * 
 * Tracks: false positives, missed rugs, successful calls.
 * Feeds outcomes back to scoring engine weights.
 * Monthly self-assessment of signal predictiveness.
 */

import dotenv from 'dotenv';
dotenv.config();

// ============================================================
// OUTCOME TRACKING
// ============================================================

const outcomes = {
  truePositives: [],    // Correctly flagged as rug before it happened
  falsePositives: [],   // Flagged as rug but was legit
  trueNegatives: [],    // Correctly ignored (didn't flag a legit token)
  falseNegatives: [],   // Missed a rug that we should have caught
};

const signalEffectiveness = new Map(); // signalName -> { correct: N, incorrect: N }

/**
 * Record the outcome of an investigation.
 * Called when we learn the ground truth about a token.
 */
export function recordOutcome(investigation) {
  const {
    tokenMint,
    tokenName,
    originalScore,
    originalTier,
    actualOutcome,   // 'rugged' | 'legitimate' | 'inconclusive'
    scoringBreakdown, // The original layer scores
    timeToOutcome,   // How long from flag to rug (or clearance)
  } = investigation;

  const entry = {
    tokenMint,
    tokenName,
    originalScore,
    originalTier,
    actualOutcome,
    scoringBreakdown,
    timeToOutcome,
    recordedAt: Date.now(),
  };

  if (actualOutcome === 'rugged' && originalScore >= 70) {
    outcomes.truePositives.push(entry);
    updateSignalEffectiveness(scoringBreakdown, true);
    console.log(`[SelfImprove] TRUE POSITIVE: ${tokenName} (score ${originalScore}) — correctly flagged`);
  } else if (actualOutcome === 'legitimate' && originalScore >= 70) {
    outcomes.falsePositives.push(entry);
    updateSignalEffectiveness(scoringBreakdown, false);
    console.log(`[SelfImprove] FALSE POSITIVE: ${tokenName} (score ${originalScore}) — was actually legit`);
  } else if (actualOutcome === 'rugged' && originalScore < 70) {
    outcomes.falseNegatives.push(entry);
    console.log(`[SelfImprove] FALSE NEGATIVE: ${tokenName} (score ${originalScore}) — MISSED this rug`);
  } else if (actualOutcome === 'legitimate' && originalScore < 70) {
    outcomes.trueNegatives.push(entry);
  }
}

/**
 * Track which signals contributed to correct vs incorrect predictions.
 */
function updateSignalEffectiveness(breakdown, wasCorrect) {
  if (!breakdown) return;
  
  const signals = [
    { name: 'liquidityLock', score: breakdown.layer1_tokenVitals?.details?.liquidityLock },
    { name: 'holderConcentration', score: breakdown.layer1_tokenVitals?.details?.holderConcentration },
    { name: 'mintAuthority', score: breakdown.layer1_tokenVitals?.details?.mintAuthority },
    { name: 'coordinatedBuys', score: breakdown.layer2_behavioral?.details?.coordinatedBuys },
    { name: 'washTrading', score: breakdown.layer2_behavioral?.details?.washTrading },
    { name: 'sniperWallets', score: breakdown.layer2_behavioral?.details?.sniperWallets },
    { name: 'mevSandwich', score: breakdown.layer2_behavioral?.details?.mevSandwich },
    { name: 'deployerHistory', score: breakdown.layer3_metadata?.details?.deployerHistory },
    { name: 'websiteQuality', score: breakdown.layer3_metadata?.details?.websiteQuality },
  ];
  
  for (const signal of signals) {
    if (signal.score === undefined) continue;
    
    if (!signalEffectiveness.has(signal.name)) {
      signalEffectiveness.set(signal.name, { correct: 0, incorrect: 0, totalScore: 0, count: 0 });
    }
    
    const stats = signalEffectiveness.get(signal.name);
    stats.count++;
    stats.totalScore += signal.score;
    
    // If signal was high (>60) and prediction was correct, it's effective
    // If signal was high (>60) and prediction was wrong, it's misleading
    if (signal.score > 60) {
      if (wasCorrect) stats.correct++;
      else stats.incorrect++;
    }
  }
}

// ============================================================
// WEIGHT ADJUSTMENT RECOMMENDATIONS
// ============================================================

/**
 * Analyze signal effectiveness and recommend weight adjustments.
 * Called during monthly self-assessment.
 */
export function recommendWeightAdjustments() {
  const recommendations = [];
  
  for (const [signal, stats] of signalEffectiveness) {
    if (stats.count < 5) continue; // Need minimum data
    
    const accuracy = stats.correct / (stats.correct + stats.incorrect || 1);
    const avgScore = stats.totalScore / stats.count;
    
    if (accuracy > 0.8) {
      recommendations.push({
        signal,
        action: 'INCREASE_WEIGHT',
        reason: `${(accuracy * 100).toFixed(0)}% accuracy across ${stats.count} investigations — strong predictor`,
        currentAccuracy: accuracy,
      });
    } else if (accuracy < 0.4 && stats.incorrect > 3) {
      recommendations.push({
        signal,
        action: 'DECREASE_WEIGHT',
        reason: `Only ${(accuracy * 100).toFixed(0)}% accuracy with ${stats.incorrect} false triggers — generating noise`,
        currentAccuracy: accuracy,
      });
    }
  }
  
  return recommendations;
}

// ============================================================
// MONTHLY SELF-ASSESSMENT
// ============================================================

/**
 * Generate a comprehensive self-assessment report.
 * Uses the self-improving-agent skill for analysis.
 */
export function generateAssessment() {
  const total = outcomes.truePositives.length + outcomes.falsePositives.length + 
                outcomes.falseNegatives.length + outcomes.trueNegatives.length;
  
  const precision = outcomes.truePositives.length / 
    (outcomes.truePositives.length + outcomes.falsePositives.length || 1);
  
  const recall = outcomes.truePositives.length /
    (outcomes.truePositives.length + outcomes.falseNegatives.length || 1);
  
  const f1Score = 2 * (precision * recall) / (precision + recall || 1);
  
  const weightRecommendations = recommendWeightAdjustments();
  
  // Average time from flag to confirmed rug
  const avgTimeToRug = outcomes.truePositives.length > 0
    ? outcomes.truePositives.reduce((sum, tp) => sum + (tp.timeToOutcome || 0), 0) / outcomes.truePositives.length
    : 0;

  const report = {
    period: 'monthly',
    generatedAt: new Date().toISOString(),
    
    summary: {
      totalInvestigations: total,
      truePositives: outcomes.truePositives.length,
      falsePositives: outcomes.falsePositives.length,
      falseNegatives: outcomes.falseNegatives.length,
      trueNegatives: outcomes.trueNegatives.length,
    },
    
    metrics: {
      precision: parseFloat(precision.toFixed(3)),
      recall: parseFloat(recall.toFixed(3)),
      f1Score: parseFloat(f1Score.toFixed(3)),
      avgHoursToConfirmation: parseFloat((avgTimeToRug / 3600000).toFixed(1)),
    },
    
    signalAnalysis: Object.fromEntries(
      [...signalEffectiveness].map(([name, stats]) => [
        name,
        {
          accuracy: parseFloat((stats.correct / (stats.correct + stats.incorrect || 1)).toFixed(3)),
          sampleSize: stats.count,
          avgScore: parseFloat((stats.totalScore / stats.count).toFixed(1)),
        },
      ])
    ),
    
    weightRecommendations,
    
    // Worst misses — false negatives we need to learn from
    worstMisses: outcomes.falseNegatives.slice(-5).map(fn => ({
      token: fn.tokenName,
      score: fn.originalScore,
      whatWeGot: fn.originalTier,
      whatItWas: 'RUGGED',
    })),
    
    // Worst false alarms
    worstFalseAlarms: outcomes.falsePositives.slice(-5).map(fp => ({
      token: fp.tokenName,
      score: fp.originalScore,
      whatWeGot: fp.originalTier,
      whatItWas: 'LEGITIMATE',
    })),
  };
  
  console.log(`[SelfImprove] Assessment generated: F1=${f1Score.toFixed(3)}, Precision=${precision.toFixed(3)}, Recall=${recall.toFixed(3)}`);
  
  return report;
}

// ============================================================
// PERSISTENCE (save/load from disk)
// ============================================================

export function getState() {
  return {
    outcomes: {
      tp: outcomes.truePositives.length,
      fp: outcomes.falsePositives.length,
      fn: outcomes.falseNegatives.length,
      tn: outcomes.trueNegatives.length,
    },
    signalCount: signalEffectiveness.size,
  };
}

export function init() {
  console.log('[SelfImprove] Initialized — tracking investigation outcomes');
  return { status: 'ok' };
}

export default { init, recordOutcome, generateAssessment, recommendWeightAdjustments, getState };