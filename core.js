(() => {
  "use strict";

  const CONFIG = Object.freeze({
    HISTORY_MS: 90000,
    MIN_GUIDANCE_MS: 15000,
    MAX_IMPORT_BYTES: 32 * 1024 * 1024,
    THRESHOLDS: Object.freeze({
      HEAVY: 60,
      PREPARE: 75,
      SWITCH: 85,
      URGENT: 95
    })
  });

  const STATE_RANK = Object.freeze({
    sampling: 0,
    transient: 0,
    normal: 0,
    heavy: 1,
    prepare: 2,
    switch: 3,
    urgent: 4
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function normalizeOptionalCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.trunc(numeric);
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * p) - 1)
    );
    return sorted[index];
  }

  function severityBlocking(ratio) {
    if (ratio == null) return null;
    return clamp((Math.max(0, ratio) / 0.12) * 100, 0, 100);
  }

  function severityJank(ratio) {
    if (ratio == null) return null;
    return clamp((Math.max(0, ratio) / 0.45) * 100, 0, 100);
  }

  function severityDrift(ms) {
    if (ms == null) return null;
    if (ms <= 5) return 0;
    return clamp(((ms - 5) / 95) * 100, 0, 100);
  }

  function severityEventLatency(ms) {
    if (ms == null) return null;
    if (ms <= 100) return 0;
    if (ms <= 200) return ((ms - 100) / 100) * 20;
    if (ms <= 500) return 20 + ((ms - 200) / 300) * 50;
    if (ms <= 1000) return 70 + ((ms - 500) / 500) * 30;
    return 100;
  }

  function calculatePagePressure({
    blockingRatio = null,
    jankRatio = null,
    driftMs = null,
    eventLatencyMs = null
  } = {}) {
    const candidates = [
      [severityBlocking(blockingRatio), 0.35],
      [severityJank(jankRatio), 0.20],
      [severityDrift(driftMs), 0.15],
      [severityEventLatency(eventLatencyMs), 0.30]
    ].filter(([value]) => value != null);

    if (!candidates.length) return null;

    const weightSum = candidates.reduce((sum, [, weight]) => sum + weight, 0);
    const weighted = candidates.reduce(
      (sum, [value, weight]) => sum + value * weight,
      0
    );

    return clamp(Math.round(weighted / weightSum), 0, 100);
  }

  function calculateWindowPressure({
    historySamples = [],
    now = 0,
    currentPressure = 0,
    loadedBlocks = 0
  } = {}) {
    const cutoff = now - CONFIG.HISTORY_MS;
    const recent = historySamples.filter((item) => item.time >= cutoff);
    const pressures = recent.map((item) => clamp(Number(item.pressure) || 0, 0, 100));

    const avgPressure = average(pressures);
    const p75Pressure = percentile(pressures, 0.75);
    const highShare = pressures.length
      ? (pressures.filter((p) => p >= 60).length / pressures.length) * 100
      : 0;

    const oldest = recent.length ? recent[0].time : now;
    const historyAgeMs = Math.max(0, now - oldest);

    // DOM 规模只占 5%：当前已加载 DOM 不是完整会话历史。
    const domLoad = clamp(((loadedBlocks - 40) / 260) * 100, 0, 100);

    let windowPressure = Math.round(
      avgPressure * 0.55 +
      p75Pressure * 0.20 +
      highShare * 0.15 +
      domLoad * 0.05 +
      clamp(currentPressure, 0, 100) * 0.05
    );

    const earlySpike =
      historyAgeMs < 20000 &&
      currentPressure >= 70;

    const isolatedSpike =
      currentPressure >= 75 &&
      avgPressure < 40 &&
      highShare < 25;

    const transientBusy = earlySpike || isolatedSpike;

    if (transientBusy) {
      windowPressure = Math.min(windowPressure, 74);
    }

    return {
      windowPressure: clamp(windowPressure, 0, 100),
      transientBusy,
      highShare: Math.round(highShare),
      avgPressure: Math.round(avgPressure),
      historyAgeMs: Math.round(historyAgeMs),
      domLoad: Math.round(domLoad)
    };
  }

  function contiguousDuration(historySamples, now, predicate) {
    const recent = historySamples
      .filter((item) => item.time <= now)
      .slice()
      .sort((a, b) => a.time - b.time);

    if (!recent.length) return 0;

    let start = now;
    let matched = false;

    for (let i = recent.length - 1; i >= 0; i -= 1) {
      if (!predicate(Number(recent[i].pressure) || 0)) break;
      start = recent[i].time;
      matched = true;
    }

    return matched ? Math.max(0, now - start) : 0;
  }

  function nextRecommendationState({
    previousState = "normal",
    windowPressure = 0,
    historySamples = [],
    now = 0,
    transientBusy = false,
    historyAgeMs = 0
  } = {}) {
    if (historyAgeMs < CONFIG.MIN_GUIDANCE_MS) return "sampling";
    if (transientBusy) return "transient";

    const above80 = contiguousDuration(historySamples, now, (p) => p >= 80);
    const above70 = contiguousDuration(historySamples, now, (p) => p >= 70);
    const above55 = contiguousDuration(historySamples, now, (p) => p >= 55);
    const above40 = contiguousDuration(historySamples, now, (p) => p >= 40);
    const below60 = contiguousDuration(historySamples, now, (p) => p < 60);

    if (windowPressure >= CONFIG.THRESHOLDS.URGENT && above80 >= 20000) {
      return "urgent";
    }
    if (windowPressure >= CONFIG.THRESHOLDS.SWITCH && above70 >= 20000) {
      return "switch";
    }
    if (windowPressure >= CONFIG.THRESHOLDS.PREPARE && above55 >= 20000) {
      return "prepare";
    }
    if (windowPressure >= CONFIG.THRESHOLDS.HEAVY && above40 >= 15000) {
      return "heavy";
    }

    if (["urgent", "switch", "prepare"].includes(previousState)) {
      if (windowPressure < 60 && below60 >= 30000) {
        return windowPressure >= 45 ? "heavy" : "normal";
      }
      return previousState;
    }

    if (previousState === "heavy") {
      if (windowPressure < 45 && below60 >= 30000) {
        return "normal";
      }
      return windowPressure >= 60 ? "heavy" : previousState;
    }

    return "normal";
  }

  function recommendationFor(metrics = {}) {
    let state = metrics.recommendationState;

    if (!state) {
      const p = clamp(Number(metrics.windowPressure) || 0, 0, 100);
      if (metrics.status === "sampling") state = "sampling";
      else if (metrics.transientBusy) state = "transient";
      else if (p >= CONFIG.THRESHOLDS.URGENT) state = "urgent";
      else if (p >= CONFIG.THRESHOLDS.SWITCH) state = "switch";
      else if (p >= CONFIG.THRESHOLDS.PREPARE) state = "prepare";
      else if (p >= CONFIG.THRESHOLDS.HEAVY) state = "heavy";
      else state = "normal";
    }
    const map = {
      sampling: {
        title: "采样中，先继续使用",
        note: "采样一会儿后，页面侧建议会更稳定。",
        level: "good"
      },
      transient: {
        title: "临时繁忙，暂时不用换窗",
        note: "检测到短时高负载，来源 UNKNOWN，已自动降权。",
        level: "warn"
      },
      heavy: {
        title: "窗口开始变重，可继续使用",
        note: "页面侧压力开始增加，先继续观察。",
        level: "warn"
      },
      prepare: {
        title: "页面侧建议准备换窗口",
        note: "页面出现持续压力，可以先把手头任务收尾。",
        level: "warn"
      },
      switch: {
        title: "页面侧建议换新窗口",
        note: "页面持续高负载，建议完成当前步骤后切到新窗口。",
        level: "bad"
      },
      urgent: {
        title: "页面侧强烈建议立即换窗口",
        note: "持续页面压力很高，继续使用更容易明显卡顿。",
        level: "bad"
      },
      normal: {
        title: "页面侧无需换窗",
        note: "只代表当前浏览器页面运行正常，不代表模型上下文还很空。",
        level: "good"
      }
    };
    return map[state] || map.normal;
  }

  function confidenceFor({
    historyAgeMs = 0,
    supportedSignals = 0,
    expectedSignals = 4,
    interactionCount = 0,
    structureMode = "unknown",
    foregroundRatio = 0
  } = {}) {
    let score = 0;

    if (historyAgeMs >= 60000) score += 30;
    else if (historyAgeMs >= 30000) score += 20;
    else if (historyAgeMs >= 15000) score += 10;

    const signalCoverage = expectedSignals > 0
      ? clamp(supportedSignals / expectedSignals, 0, 1)
      : 0;
    score += signalCoverage * 30;

    if (interactionCount >= 10) score += 15;
    else if (interactionCount >= 3) score += 10;
    else if (interactionCount >= 1) score += 5;

    if (structureMode === "primary") score += 15;
    else if (structureMode === "fallback") score += 8;

    score += clamp(foregroundRatio, 0, 1) * 10;
    score = Math.round(score);

    // 缺少真实交互样本或仅兼容识别时，不允许显示“高”。
    let cap = 100;
    if (interactionCount === 0) cap = Math.min(cap, 69);
    if (structureMode === "fallback") cap = Math.min(cap, 74);
    if (structureMode === "unknown") cap = Math.min(cap, 49);

    score = Math.min(score, cap);

    return {
      score,
      label: score >= 75 ? "高" : score >= 50 ? "中" : "低"
    };
  }

  function reasonsFor(metrics = {}) {
    const reasons = [];

    if (metrics.transientBusy) {
      reasons.push("检测到短时高负载，已自动降权");
    }

    if (metrics.eventLatencyMs == null) {
      reasons.push("交互响应暂无有效样本");
    } else if (Number(metrics.eventLatencyMs) > 500) {
      reasons.push("交互响应明显偏慢");
    } else if (Number(metrics.eventLatencyMs) > 200) {
      reasons.push("交互响应开始变慢");
    }

    if (metrics.blockingRatio == null) {
      reasons.push("页面阻塞指标暂不可用");
    } else if (Number(metrics.blockingRatio) >= 8) {
      reasons.push("页面阻塞偏高");
    }

    if (Number(metrics.jankRatio) >= 18) {
      reasons.push("掉帧偏多");
    }

    if (Number(metrics.driftMs) >= 35) {
      reasons.push("响应延迟偏高");
    }

    if (metrics.structureMode === "unknown") {
      reasons.push("暂未识别到可优化的页面结构");
    }

    if (!reasons.length) {
      reasons.push("当前各项可测页面指标正常");
    }

    return reasons.slice(0, 3);
  }

  function depthLevelFor(messageCount, toolMessages) {
    const total = Math.max(0, Number(messageCount) || 0);
    const tools = Math.max(0, Number(toolMessages) || 0);

    if (total >= 1500 || tools >= 700) return "very_high";
    if (total >= 700 || tools >= 300) return "high";
    if (total >= 250 || tools >= 100) return "medium";
    return "low";
  }

  function summarizeMapping(mapping, currentNode = null) {
    const map = mapping && typeof mapping === "object" ? mapping : {};

    let nodes = [];

    // 优先沿 current_node → parent 回溯当前活动分支。
    // 这避免把编辑/重试产生的旁支也统计进“当前窗口历史”。
    if (currentNode && map[currentNode]) {
      const seen = new Set();
      let cursor = currentNode;

      while (cursor && map[cursor] && !seen.has(cursor)) {
        seen.add(cursor);
        nodes.push(map[cursor]);
        cursor = map[cursor].parent || null;
      }
    } else {
      nodes = Object.values(map);
    }

    let totalMessages = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolMessages = 0;
    let systemMessages = 0;

    for (const node of nodes) {
      const message = node && node.message;
      if (!message || typeof message !== "object") continue;

      totalMessages += 1;

      const role =
        message.author && typeof message.author === "object"
          ? message.author.role
          : null;

      if (role === "user") userMessages += 1;
      else if (role === "assistant") assistantMessages += 1;
      else if (role === "tool") toolMessages += 1;
      else if (role === "system") systemMessages += 1;
    }

    return {
      totalMessages,
      userMessages,
      assistantMessages,
      toolMessages,
      systemMessages,
      activeBranch: Boolean(currentNode && map[currentNode])
    };
  }

  function summarizeConversationObject(conversation, byteSize, sourceKind) {
    if (!conversation || typeof conversation !== "object") {
      return { valid: false, error: "会话对象无效" };
    }

    const counts = summarizeMapping(
      conversation.mapping,
      conversation.current_node || conversation.currentNode || null
    );
    const conversationId =
      conversation.id ||
      conversation.conversation_id ||
      conversation.conversationId ||
      null;

    const messageCount =
      Number(conversation.message_count) ||
      Number(conversation.messageCount) ||
      counts.totalMessages;

    return {
      valid: true,
      sourceKind,
      format: sourceKind === "openai_export"
        ? "OPENAI_OFFICIAL_EXPORT"
        : null,
      schemaVersion: null,
      exportedAt: null,
      coverage: "exported_conversation",
      conversationId,
      title: conversation.title || null,
      messageCount,
      assetCount: null,
      userMessages: counts.userMessages,
      assistantMessages: counts.assistantMessages,
      toolMessages: counts.toolMessages,
      systemMessages: counts.systemMessages,
      activeBranchCounted: counts.activeBranch,
      byteSize: Math.max(0, Number(byteSize) || 0),
      depthLevel: depthLevelFor(messageCount, counts.toolMessages)
    };
  }

  function extractBridgeSummary(payload, byteSize = 0) {
    if (!payload || typeof payload !== "object") {
      return { valid: false, error: "JSON 结构无效" };
    }

    if (payload.format !== "CHATGPT_CONTEXT_BRIDGE") {
      return { valid: false, error: "不是 Context Bridge JSON" };
    }

    const source = payload.source_refs || {};
    const state = payload.current_state || {};
    const raw = payload.raw_conversation || {};
    const counts = summarizeMapping(
      raw.mapping,
      raw.current_node || raw.currentNode || null
    );

    const messageCount =
      Number(source.message_count) ||
      Number(state.message_count) ||
      counts.totalMessages;

    const explicitAssetCount = normalizeOptionalCount(state.asset_count);
    const assetCount = explicitAssetCount != null
      ? explicitAssetCount
      : Array.isArray(payload.asset_ledger)
        ? payload.asset_ledger.length
        : null;

    const conversationId =
      source.conversation_id ||
      state.conversation_id ||
      raw.conversation_id ||
      null;

    return {
      valid: true,
      sourceKind: "context_bridge",
      format: payload.format,
      schemaVersion: payload.schema_version || null,
      exportedAt: payload.exported_at || source.captured_at || null,
      coverage: source.coverage || state.coverage || null,
      conversationId,
      title: source.title || payload.title || null,
      messageCount,
      assetCount,
      userMessages: counts.userMessages,
      assistantMessages: counts.assistantMessages,
      toolMessages: counts.toolMessages,
      systemMessages: counts.systemMessages,
      activeBranchCounted: counts.activeBranch,
      byteSize: Math.max(0, Number(byteSize) || 0),
      depthLevel: depthLevelFor(messageCount, counts.toolMessages)
    };
  }

  function extractHistorySummary(
    payload,
    byteSize = 0,
    currentConversationId = null
  ) {
    // 1) Context Bridge structured export.
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.format === "CHATGPT_CONTEXT_BRIDGE"
    ) {
      return extractBridgeSummary(payload, byteSize);
    }

    // 2) OpenAI official export: normally an array of conversation objects.
    let candidates = null;

    if (Array.isArray(payload)) {
      candidates = payload;
    } else if (
      payload &&
      typeof payload === "object" &&
      Array.isArray(payload.conversations)
    ) {
      candidates = payload.conversations;
    } else if (
      payload &&
      typeof payload === "object" &&
      payload.mapping &&
      (
        payload.id ||
        payload.conversation_id ||
        payload.conversationId
      )
    ) {
      candidates = [payload];
    }

    if (!candidates) {
      return {
        valid: false,
        error: "无法识别 JSON：支持 Context Bridge 或 OpenAI 官方会话导出"
      };
    }

    const normalizedCurrent = currentConversationId
      ? String(currentConversationId).toLowerCase()
      : null;

    let selected = null;

    if (normalizedCurrent) {
      selected = candidates.find((item) => {
        if (!item || typeof item !== "object") return false;
        const id =
          item.id ||
          item.conversation_id ||
          item.conversationId ||
          null;
        return id && String(id).toLowerCase() === normalizedCurrent;
      }) || null;
    }

    // Fail-Closed: 多会话官方导出若无法按当前 ID 定位，不猜“哪个最像”。
    if (!selected) {
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        return {
          valid: false,
          error:
            normalizedCurrent
              ? `官方导出中未找到当前 conversation ID（共 ${candidates.length} 个会话）`
              : `官方导出包含 ${candidates.length} 个会话，但当前页面 conversation ID UNKNOWN`
        };
      }
    }

    return summarizeConversationObject(
      selected,
      byteSize,
      "openai_export"
    );
  }

  function maxState(a, b) {
    return (STATE_RANK[a] || 0) >= (STATE_RANK[b] || 0) ? a : b;
  }

  function combinedRecommendationFor({
    pageMetrics = {},
    calibration = null
  } = {}) {
    const pageState = pageMetrics.recommendationState || "normal";

    if (!calibration) {
      return {
        state: pageState,
        title: "历史深度 UNKNOWN",
        note: "历史深度 UNKNOWN；当前只能判断页面性能，不能据此判断模型上下文。",
        basis: "仅页面性能"
      };
    }

    if (calibration.matchesCurrentConversation === false) {
      return {
        state: pageState,
        title: "历史快照未匹配",
        note: "导入的窗口分析 JSON 不属于当前窗口，已忽略历史校准。",
        basis: "仅页面性能"
      };
    }

    let historyFloor = "normal";
    if (calibration.depthLevel === "very_high") historyFloor = "switch";
    else if (calibration.depthLevel === "high") historyFloor = "prepare";
    else if (calibration.depthLevel === "medium") historyFloor = "heavy";

    const state = maxState(pageState, historyFloor);
    const map = {
      urgent: "强烈建议立即换窗口",
      switch: "建议换新窗口",
      prepare: "建议准备换窗口",
      heavy: "继续观察，窗口已偏重",
      normal: "当前综合无需换窗",
      transient: "临时繁忙，先观察",
      sampling: "页面仍在采样"
    };

    return {
      state,
      title: map[state] || map.normal,
      note:
        calibration.depthLevel === "very_high"
          ? "历史快照显示会话结构已经很深；即使页面当前流畅，也建议新开窗口继续长期工作。"
          : "综合页面性能与本机导入的历史快照判断。",
      basis: "页面性能 + 历史快照"
    };
  }

  globalThis.CGPTPerfCore = Object.freeze({
    CONFIG,
    clamp,
    average,
    normalizeOptionalCount,
    percentile,
    calculatePagePressure,
    calculateWindowPressure,
    nextRecommendationState,
    recommendationFor,
    confidenceFor,
    reasonsFor,
    extractBridgeSummary,
    extractHistorySummary,
    combinedRecommendationFor,
    depthLevelFor
  });
})();
