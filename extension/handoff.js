(() => {
  "use strict";

  const WebExt = globalThis.browser || globalThis.chrome;

  function buildPrompt() {
    return [
      "请把当前整个对话压缩成一份用于新 ChatGPT 窗口继续工作的高保真交接包。不要展开长篇解释，只保留会影响后续执行的事实、约束和状态。",
      "",
      "必须按以下状态语义组织，不能把旧事实复活，也不能把未验证内容升级为已验证：",
      "- CURRENT：当前唯一有效目标、阶段、方案与身份。",
      "- VERIFIED：已经有 Evidence 支持的事实、测试和结果。",
      "- PENDING：尚未验证或仍待完成。",
      "- BLOCKED：真实阻塞及解除条件。",
      "- HISTORICAL：仅供追溯的旧版本或旧方案，不得作为当前基线。",
      "- REJECTED：已否决或已废弃方案及原因。",
      "",
      "工程身份若存在必须逐字保留：repo / branch / exact SHA / version / test result / 权限与发布状态。",
      "还必须保留：当前目标、当前阶段、已确认决定、硬约束、已完成 Evidence、当前问题、下一步、Stop Rule。",
      "若某字段在当前对话里没有可靠证据，写 UNKNOWN，不要猜。",
      "最后输出一个可直接粘贴到新窗口的紧凑交接块；不要自动执行任何下一步。"
    ].join("\n");
  }

  function findComposer() {
    if (typeof document === "undefined") return null;
    const selectors = [
      "textarea#prompt-textarea",
      "textarea[data-testid='prompt-textarea']",
      "#prompt-textarea[contenteditable='true']",
      "[data-testid='prompt-textarea'][contenteditable='true']",
      "div[contenteditable='true'][role='textbox']"
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function writeComposer(node, prompt) {
    if (node.tagName === "TEXTAREA" || node.tagName === "INPUT") {
      const proto = Object.getPrototypeOf(node);
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && typeof descriptor.set === "function") descriptor.set.call(node, prompt);
      else node.value = prompt;
    } else {
      node.textContent = prompt;
    }

    const EventCtor = globalThis.InputEvent || globalThis.Event;
    if (EventCtor) {
      node.dispatchEvent(new EventCtor("input", {
        bubbles: true,
        inputType: "insertText",
        data: prompt
      }));
    }
    if (typeof node.focus === "function") node.focus();
  }

  function insertPrompt(prompt = buildPrompt()) {
    const composer = findComposer();
    if (!composer) return { ok: false, error: "未找到 ChatGPT 输入框" };
    writeComposer(composer, String(prompt));
    return { ok: true };
  }

  globalThis.CGPTHandoff = Object.freeze({
    buildPrompt,
    insertPrompt
  });

  if (WebExt && WebExt.runtime && WebExt.runtime.onMessage) {
    WebExt.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== "prepareHandoffPrompt") return;
      sendResponse(insertPrompt(buildPrompt()));
      return true;
    });
  }
})();
