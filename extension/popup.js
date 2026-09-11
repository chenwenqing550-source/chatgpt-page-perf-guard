(() => {
  "use strict";

  const Core = globalThis.CGPTPerfCore;
  if (!Core) return;

  const WebExt = globalThis.browser || globalThis.chrome;
  if (!WebExt || !WebExt.tabs) return;

  const els = {
    statusPill: document.getElementById("statusPill"),
    pagePressure: document.getElementById("pagePressure"),
    pressureBar: document.getElementById("pressureBar"),
    pageAdvice: document.getElementById("pageAdvice"),
    combinedAdvice: document.getElementById("combinedAdvice"),
    confidence: document.getElementById("confidence"),
    recommendation: document.getElementById("recommendation"),
    recommendationNote: document.getElementById("recommendationNote"),
    reasons: document.getElementById("reasons"),
    historyDepth: document.getElementById("historyDepth"),
    historyNote: document.getElementById("historyNote"),
    historyStats: document.getElementById("historyStats"),
    importButton: document.getElementById("importHistoryButton"),
    historyFile: document.getElementById("historyFile"),
    importStatus: document.getElementById("importStatus"),
    toggle: document.getElementById("optimizationToggle"),
    prepareHandoff: document.getElementById("prepareHandoffButton"),
    handoffStatus: document.getElementById("handoffStatus"),
    blackBoxStatus: document.getElementById("blackBoxStatus"),
    blackBoxEventCount: document.getElementById("blackBoxEventCount"),
    blackBoxCheckpointState: document.getElementById("blackBoxCheckpointState"),
    blackBoxLastSend: document.getElementById("blackBoxLastSend"),
    blackBoxCluster: document.getElementById("blackBoxCluster"),
    exportSendIncidentButton: document.getElementById("exportSendIncidentButton"),
    exportRecentBlackBoxButton: document.getElementById("exportRecentBlackBoxButton"),
    markIncidentButton: document.getElementById("markIncidentButton"),
    blackBoxActionStatus: document.getElementById("blackBoxActionStatus"),
    activityState: document.getElementById("activityState"),
    probeState: document.getElementById("probeState"),
    selfWork: document.getElementById("selfWork"),
    recentIncident: document.getElementById("recentIncident"),
    windowPressure: document.getElementById("windowPressure"),
    coverage: document.getElementById("coverage"),
    blocking: document.getElementById("blocking"),
    jank: document.getElementById("jank"),
    eventLatency: document.getElementById("eventLatency"),
    drift: document.getElementById("drift"),
    loadedBlocks: document.getElementById("loadedBlocks"),
    structure: document.getElementById("structure"),
    signalCoverage: document.getElementById("signalCoverage"),
    interactionCount: document.getElementById("interactionCount"),
    notice: document.getElementById("notice")
  };

  let activeTabId = null;
  let refreshTimer = null;
  let currentConversationId = null;
  let blackBoxAvailable = false;

  function setPill(text, cls) {
    els.statusPill.textContent = text;
    els.statusPill.className = `pill ${cls || ""}`.trim();
  }

  function valueOrUnknown(value, suffix = "") {
    return value == null ? "UNKNOWN" : `${value}${suffix}`;
  }

  function structureLabel(mode) {
    if (mode === "primary") return "正常";
    if (mode === "fallback") return "兼容模式";
    return "UNKNOWN";
  }

  function activityLabel(state) {
    const map = {
      quiet: "安静",
      generating: "生成中·已让路",
      scrolling: "滚动中·已让路",
      busy: "繁忙·最低干扰",
      background: "后台休眠"
    };
    return map[state] || "UNKNOWN";
  }

  function pageAdviceLabel(state) {
    const map = {
      sampling: "采样中",
      transient: "暂不需要",
      normal: "无需换窗",
      heavy: "继续观察",
      prepare: "准备换窗",
      switch: "建议换窗",
      urgent: "立即换窗"
    };
    return map[state] || "继续观察";
  }

  function depthLabel(level) {
    const map = {
      low: "较浅",
      medium: "中等",
      high: "较深",
      very_high: "很深"
    };
    return map[level] || "UNKNOWN";
  }

  function bytesLabel(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function latestBlockingIncident(metrics) {
    const incidents = Array.isArray(metrics.recentIncidents)
      ? metrics.recentIncidents
      : [];
    for (let i = incidents.length - 1; i >= 0; i -= 1) {
      const item = incidents[i];
      if (!item) continue;
      if (item.kind === "long-animation-frame" || item.kind === "longtask") {
        return `${Math.round(Number(item.duration) || 0)} ms`;
      }
    }
    return "暂无 ≥50 ms 事件";
  }

  function checkpointLabel(state) {
    const labels = {
      "memory-only": "仅页面内存",
      "session-loading": "恢复中",
      "session-empty": "会话内暂无快照",
      "session-restored": "已恢复会话快照",
      "session-saving": "保存中",
      "session-saved": "会话内已保护",
      "session-error": "保存异常",
      "session-suspended": "保存已暂停",
      "session-mismatch": "其他聊天快照",
      unavailable: "不可用"
    };
    return labels[state] || "UNKNOWN";
  }

  function markerAgeLabel(marker) {
    if (!marker || !Number.isFinite(Number(marker.wallTimeMs))) return "暂无";
    const ageMs = Math.max(0, Date.now() - Number(marker.wallTimeMs));
    if (ageMs < 5000) return "刚刚";
    if (ageMs < 60000) return `${Math.round(ageMs / 1000)} 秒前`;
    return `${Math.round(ageMs / 60000)} 分钟前`;
  }

  function setBlackBoxActionsDisabled(disabled) {
    els.exportSendIncidentButton.disabled = disabled;
    els.exportRecentBlackBoxButton.disabled = disabled;
    els.markIncidentButton.disabled = disabled;
  }

  function setBlackBoxActionStatus(text, bad = false) {
    els.blackBoxActionStatus.className = bad ? "import-status bad" : "import-status";
    els.blackBoxActionStatus.classList.remove("hidden");
    els.blackBoxActionStatus.textContent = text;
  }

  function renderBlackBoxStatus(status) {
    if (!status) {
      blackBoxAvailable = false;
      els.blackBoxStatus.textContent = "诊断状态不可用";
      els.blackBoxEventCount.textContent = "UNKNOWN";
      els.blackBoxCheckpointState.textContent = "UNKNOWN";
      els.blackBoxLastSend.textContent = "UNKNOWN";
      els.blackBoxCluster.textContent = "UNKNOWN";
      setBlackBoxActionsDisabled(true);
      return;
    }

    blackBoxAvailable = true;
    const eventCount = Number(status.eventCount) || 0;
    const clusterCount = Number(status.severeClusterCount) || 0;
    els.blackBoxStatus.textContent = `事件 ${eventCount} · 严重事件簇 ${clusterCount}`;
    els.blackBoxEventCount.textContent = String(eventCount);
    els.blackBoxCheckpointState.textContent = checkpointLabel(status.checkpointState);
    els.blackBoxLastSend.textContent = markerAgeLabel(status.lastSendMarker);

    const cluster = status.latestSevereCluster;
    if (cluster) {
      const count = Number(cluster.count) || 0;
      const maxDuration = Math.round(Number(cluster.maxDuration) || 0);
      els.blackBoxCluster.textContent = `${clusterCount || 1} 组 · 最近 ${count} 次 / 峰值 ${maxDuration} ms`;
    } else {
      els.blackBoxCluster.textContent = "暂无严重事件簇";
    }
    setBlackBoxActionsDisabled(false);
  }

  function renderReasons(metrics) {
    const reasons = Core.reasonsFor(metrics);
    const fragment = document.createDocumentFragment();
    for (const reason of reasons) {
      const li = document.createElement("li");
      li.textContent = reason;
      fragment.appendChild(li);
    }
    els.reasons.replaceChildren(fragment);
  }

  function renderHistory(calibration) {
    if (!calibration) {
      els.historyDepth.textContent = "UNKNOWN";
      els.historyNote.textContent = "UNKNOWN · 默认不读取完整聊天历史";
      els.historyStats.classList.add("hidden");
      els.historyStats.textContent = "";
      return;
    }

    if (!calibration.matchesCurrentConversation) {
      els.historyDepth.textContent = "未匹配";
      els.historyNote.textContent = "导入快照不属于当前聊天窗口";
      els.historyStats.classList.remove("hidden");
      els.historyStats.textContent = `快照消息 ${calibration.messageCount} 条 · 已忽略历史校准`;
      return;
    }

    els.historyDepth.textContent = depthLabel(calibration.depthLevel);
    const sourceLabel = calibration.sourceKind === "openai_export"
      ? "OpenAI 官方导出"
      : "Context Bridge";
    els.historyNote.textContent = `${sourceLabel}校准 · 不等于模型上下文占用`;
    els.historyStats.classList.remove("hidden");

    const assetText = calibration.assetCount == null ? "UNKNOWN" : String(calibration.assetCount);
    const branchText = calibration.activeBranchCounted ? "活动分支" : "可见映射";
    els.historyStats.textContent =
      `${branchText}消息 ${calibration.messageCount} 条 · ` +
      `用户 ${calibration.userMessages} · 助手 ${calibration.assistantMessages} · ` +
      `工具 ${calibration.toolMessages} · 资产 ${assetText} · ` +
      `导入文件 ${bytesLabel(calibration.byteSize)}`;
  }

  function showUnavailable() {
    setPill("未连接", "bad");
    els.notice.classList.remove("hidden");
    els.pagePressure.textContent = "UNKNOWN";
    els.pressureBar.style.width = "0%";
    els.pageAdvice.textContent = "UNKNOWN";
    els.combinedAdvice.textContent = "UNKNOWN";
    els.confidence.textContent = "低";
    els.recommendation.textContent = "未检测到 ChatGPT 页面";
    els.recommendation.className = "recommendation bad";
    els.recommendationNote.textContent = "请先打开或刷新 chatgpt.com。";
    els.reasons.replaceChildren();
    renderHistory(null);
    els.activityState.textContent = "UNKNOWN";
    els.probeState.textContent = "UNKNOWN";
    els.selfWork.textContent = "UNKNOWN";
    els.recentIncident.textContent = "UNKNOWN";
    els.windowPressure.textContent = "UNKNOWN";
    els.coverage.textContent = "UNKNOWN";
    els.blocking.textContent = "UNKNOWN";
    els.jank.textContent = "UNKNOWN";
    els.eventLatency.textContent = "UNKNOWN";
    els.drift.textContent = "UNKNOWN";
    els.loadedBlocks.textContent = "--";
    els.structure.textContent = "UNKNOWN";
    els.signalCoverage.textContent = "--";
    els.interactionCount.textContent = "--";
    els.toggle.disabled = true;
    els.prepareHandoff.disabled = true;
    blackBoxAvailable = false;
    renderBlackBoxStatus(null);
  }

  function render(metrics) {
    currentConversationId = metrics.currentConversationId || null;
    const rec = Core.recommendationFor(metrics);
    const combined = Core.combinedRecommendationFor({
      pageMetrics: metrics,
      calibration: metrics.historyCalibration || null
    });
    const confidence = Core.confidenceFor({
      historyAgeMs: Number(metrics.historyAgeMs) || 0,
      supportedSignals: Number(metrics.supportedSignals) || 0,
      expectedSignals: Number(metrics.expectedSignals) || 4,
      interactionCount: Number(metrics.interactionCount) || 0,
      structureMode: metrics.structureMode || "unknown",
      foregroundRatio: Number(metrics.foregroundRatio) || 0
    });

    els.notice.classList.add("hidden");
    els.prepareHandoff.disabled = false;
    if (blackBoxAvailable) setBlackBoxActionsDisabled(false);

    if (metrics.status === "sampling") {
      setPill("采样中", "good");
    } else if (combined.state === "urgent" || combined.state === "switch") {
      setPill("建议换窗", "bad");
    } else if (combined.state === "prepare" || combined.state === "heavy") {
      setPill("窗口偏重", "warn");
    } else if (metrics.activityState && metrics.activityState !== "quiet") {
      setPill("主动让路", "warn");
    } else if (metrics.transientBusy) {
      setPill("临时繁忙", "warn");
    } else {
      setPill("运行正常", "good");
    }

    if (metrics.pagePressure == null) {
      els.pagePressure.textContent = "UNKNOWN";
      els.pressureBar.style.width = "0%";
    } else {
      const pressure = Core.clamp(Number(metrics.pagePressure) || 0, 0, 100);
      els.pagePressure.textContent = `${pressure}%`;
      els.pressureBar.style.width = `${pressure}%`;
    }

    els.pageAdvice.textContent = pageAdviceLabel(metrics.recommendationState);
    els.combinedAdvice.textContent = combined.title;
    els.confidence.textContent = `${confidence.label}（${confidence.score}/100）`;

    if (metrics.historyCalibration) {
      const combinedLevel =
        combined.state === "urgent" || combined.state === "switch"
          ? "bad"
          : combined.state === "prepare" || combined.state === "heavy"
            ? "warn"
            : "good";
      els.recommendation.textContent = combined.title;
      els.recommendation.className = `recommendation ${combinedLevel}`;
      els.recommendationNote.textContent = combined.note;
    } else {
      els.recommendation.textContent = rec.title;
      els.recommendation.className = `recommendation ${rec.level}`;
      els.recommendationNote.textContent = `${rec.note} · 历史深度 UNKNOWN`;
    }

    renderReasons(metrics);
    renderHistory(metrics.historyCalibration || null);

    els.activityState.textContent = activityLabel(metrics.activityState);
    els.probeState.textContent = metrics.activeProbeSuppressed ? "已让路" : "允许轻量探针";
    els.selfWork.textContent = valueOrUnknown(metrics.selfWorkMs, " ms");
    els.recentIncident.textContent = latestBlockingIncident(metrics);
    els.windowPressure.textContent = valueOrUnknown(metrics.windowPressure, "%");
    els.coverage.textContent = valueOrUnknown(metrics.coverage, "%");
    els.blocking.textContent = valueOrUnknown(metrics.blockingRatio, "%");
    els.jank.textContent = valueOrUnknown(metrics.jankRatio, "%");
    els.eventLatency.textContent = valueOrUnknown(metrics.eventLatencyMs, " ms");
    els.drift.textContent = valueOrUnknown(metrics.driftMs, " ms");
    els.loadedBlocks.textContent = String(Number(metrics.loadedBlocks || 0));
    els.structure.textContent = structureLabel(metrics.structureMode);
    els.signalCoverage.textContent = `${Number(metrics.supportedSignals || 0)}/${Number(metrics.expectedSignals || 4)}`;
    els.interactionCount.textContent = String(Number(metrics.interactionCount || 0));

    els.toggle.checked = Boolean(metrics.optimizationEnabled);
    els.toggle.disabled = false;
  }

  async function resolveActiveTab() {
    const tabs = await WebExt.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs && tabs[0] ? tabs[0].id : null;
    return activeTabId;
  }

  async function send(type, extra = {}) {
    if (activeTabId == null) await resolveActiveTab();
    if (activeTabId == null) throw new Error("No active tab");
    return WebExt.tabs.sendMessage(activeTabId, { type, ...extra });
  }

  async function refresh() {
    try {
      const response = await send("getMetrics");
      if (!response || !response.ok) throw new Error("No metrics");
      render(response.metrics);
    } catch (_) {
      activeTabId = null;
      showUnavailable();
    }
  }

  async function refreshBlackBoxStatus() {
    try {
      const response = await send("getBlackBoxStatus");
      if (!response || !response.ok) throw new Error("Black box unavailable");
      renderBlackBoxStatus(response.status);
    } catch (_) {
      renderBlackBoxStatus(null);
    }
  }

  function blackBoxFileName(kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `chatgpt-perf-${kind}-${stamp}.json`;
  }

  function downloadBlackBoxPayload(payload, kind) {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = blackBoxFileName(kind);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBlackBox(kind) {
    setBlackBoxActionsDisabled(true);
    setBlackBoxActionStatus("正在本机整理性能证据…");
    try {
      const response = await send("exportBlackBox", { kind });
      if (!response || !response.ok || !response.payload) {
        throw new Error(response && response.error ? response.error : "导出失败");
      }
      if (kind === "send" && !(response.payload.summary && response.payload.summary.marker)) {
        throw new Error("暂无发送标记，请先正常发送一条消息后再导出");
      }
      downloadBlackBoxPayload(response.payload, kind);
      const count = response.payload.summary && Number(response.payload.summary.eventCount);
      setBlackBoxActionStatus(`已导出 ${Number.isFinite(count) ? count : 0} 条性能事件；文件未上传。`);
    } catch (error) {
      setBlackBoxActionStatus(`导出失败：${error && error.message ? error.message : "UNKNOWN"}`, true);
    } finally {
      if (blackBoxAvailable) setBlackBoxActionsDisabled(false);
    }
  }

  els.toggle.addEventListener("change", async () => {
    const desired = els.toggle.checked;
    els.toggle.disabled = true;
    try {
      const response = await send("toggleOptimization", { enabled: desired });
      if (!response || !response.ok) throw new Error("Toggle failed");
      await refresh();
    } catch (_) {
      showUnavailable();
    }
  });

  els.exportSendIncidentButton.addEventListener("click", async () => {
    await exportBlackBox("send");
  });

  els.exportRecentBlackBoxButton.addEventListener("click", async () => {
    await exportBlackBox("recent");
  });

  els.markIncidentButton.addEventListener("click", async () => {
    setBlackBoxActionsDisabled(true);
    setBlackBoxActionStatus("正在标记当前卡顿现场…");
    try {
      const response = await send("markBlackBoxIncident");
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "标记失败");
      }
      renderBlackBoxStatus(response.status);
      setBlackBoxActionStatus("已标记。恢复后可导出最近现场。");
    } catch (error) {
      setBlackBoxActionStatus(`标记失败：${error && error.message ? error.message : "UNKNOWN"}`, true);
    } finally {
      if (blackBoxAvailable) setBlackBoxActionsDisabled(false);
    }
  });

  els.prepareHandoff.addEventListener("click", async () => {
    els.prepareHandoff.disabled = true;
    els.handoffStatus.className = "import-status";
    els.handoffStatus.classList.remove("hidden");
    els.handoffStatus.textContent = "正在准备结构化交接指令…";
    try {
      const response = await send("prepareHandoffPrompt");
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "准备失败");
      }
      els.handoffStatus.textContent = "已填入当前输入框。请检查后手动发送；扩展不会自动发送或新建聊天。";
    } catch (error) {
      els.handoffStatus.className = "import-status bad";
      els.handoffStatus.textContent = `准备失败：${error && error.message ? error.message : "UNKNOWN"}`;
    } finally {
      els.prepareHandoff.disabled = false;
    }
  });

  els.importButton.addEventListener("click", () => {
    els.historyFile.value = "";
    els.historyFile.click();
  });

  els.historyFile.addEventListener("change", async () => {
    const file = els.historyFile.files && els.historyFile.files[0];
    if (!file) return;

    els.importStatus.className = "import-status";
    els.importStatus.classList.remove("hidden");
    els.importStatus.textContent = "正在本机解析…";

    try {
      if (file.size > Core.CONFIG.MAX_IMPORT_BYTES) throw new Error("文件超过 32 MB 安全上限");
      const raw = await file.text();
      const payload = JSON.parse(raw);
      const summary = Core.extractHistorySummary(payload, file.size, currentConversationId);
      if (!summary.valid) throw new Error(summary.error || "窗口分析 JSON 无效");

      const response = await send("setHistoryCalibration", { summary });
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : "校准失败");
      }

      if (response.calibration && response.calibration.matchesCurrentConversation) {
        els.importStatus.textContent = `校准成功：${summary.messageCount} 条结构化消息，历史深度 ${depthLabel(summary.depthLevel)}。`;
      } else {
        els.importStatus.className = "import-status bad";
        els.importStatus.textContent = "文件已解析，但 conversation ID 与当前窗口不匹配；历史校准不会参与建议。";
      }
      await refresh();
    } catch (error) {
      els.importStatus.className = "import-status bad";
      els.importStatus.textContent = `导入失败：${error && error.message ? error.message : "UNKNOWN"}`;
    }
  });

  refresh()
    .then(() => refreshBlackBoxStatus())
    .finally(() => {
      refreshTimer = setInterval(refresh, 2000);
    });

  window.addEventListener("unload", () => {
    if (refreshTimer) clearInterval(refreshTimer);
  }, { once: true });
})();
