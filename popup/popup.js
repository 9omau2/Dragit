/**
 * Dragit - Popup UI Logic
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Elements - Main & Header
  const mainTranslateToggle = document.getElementById("main-translate-toggle");

  // Navigation
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const domainCountBadge = document.getElementById("domain-count-badge");

  // Translation Tab
  const selectTargetLang = document.getElementById("select-target-lang");
  const selectActiveDomain = document.getElementById("select-active-domain");
  const pdfToggle = document.getElementById('pdf-viewer-toggle');
  const pdfOptions = document.getElementById('pdf-viewer-options');
  const chameleonToggle = document.getElementById('chameleon-toggle');
  const resultFormatToggle = document.getElementById('result-format-toggle');

  // Domain Management Tab
  const domainListContainer = document.getElementById("domain-list-container");
  const btnOpenAddDomain = document.getElementById("btn-open-add-domain");
  const domainModal = document.getElementById("domain-modal");
  const btnCloseDomainModal = document.getElementById("btn-close-domain-modal");
  const btnCancelDomainModal = document.getElementById("btn-cancel-domain-modal");
  const domainForm = document.getElementById("domain-form");
  const domainFormId = document.getElementById("domain-form-id");
  const domainFormName = document.getElementById("domain-form-name");
  const domainFormDesc = document.getElementById("domain-form-desc");
  const domainFormPrompt = document.getElementById("domain-form-prompt");
  const modalTitle = document.getElementById("modal-title");

  // API Settings Tab (Gemini only)
  const inputGeminiKey = document.getElementById("input-gemini-key");
  const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");
  const selectGeminiModel = document.getElementById("select-gemini-model");
  const btnTestGeminiKey = document.getElementById("btn-test-gemini-key");
  const geminiTestResult = document.getElementById("gemini-test-result");

  // Toast
  const toastMessage = document.getElementById("toast-message");

  // In-memory state
  let domainPresets = [];
  let selectedDomainId = "";

  // 2. Load stored settings
  const storageData = await chrome.storage.local.get([
    'geminiApiKey',
    'geminiModel',
    'targetLang',
    'selectedDomainId',
    'domainPresets',
    'selectionEnabled',
    'pdfViewerEnabled',
    'chameleonEnabled',
    'resultFormatEnabled',
    'resultFontFamily',
    'resultFontSize'
  ]);

  domainPresets = storageData.domainPresets || [];
  selectedDomainId = storageData.selectedDomainId || "";

  const storedModel = storageData.geminiModel || globalThis.AI_TRANSLATOR_DEFAULTS.model;
  mainTranslateToggle.checked = storageData.selectionEnabled ?? true;
  pdfToggle.checked = storageData.pdfViewerEnabled === true;
  pdfOptions.hidden = !pdfToggle.checked;
  chameleonToggle.checked = storageData.chameleonEnabled === true;
  resultFormatToggle.checked = storageData.resultFormatEnabled === true;
  resultFormatToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ resultFormatEnabled: resultFormatToggle.checked });
  });
  chameleonToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ chameleonEnabled: chameleonToggle.checked });
  });

  pdfToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ pdfViewerEnabled: pdfToggle.checked });
    pdfOptions.hidden = !pdfToggle.checked;
  });
  document.getElementById('btn-open-pdf').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const viewer = new URL(chrome.runtime.getURL('pdf/viewer.html'));
      if (tab?.url && /^(https?|file):/i.test(tab.url) && /\.pdf(?:[?#]|$)/i.test(tab.url)) viewer.searchParams.set('file', tab.url);
      await chrome.tabs.create({ url: viewer.href });
    } catch { showToast('PDF 뷰어를 열지 못했습니다. 다시 시도해주세요.'); }
  });

  const fonts = globalThis.DRAGIT_RESULT_FONTS;
  const fontFamily = document.getElementById('select-result-font');
  const fontSize = document.getElementById('select-result-font-size');
  const fontSmaller = document.getElementById('btn-font-smaller');
  const fontLarger = document.getElementById('btn-font-larger');
  for (const size of fonts.sizes) fontSize.add(new Option(`${size} px`, String(size)));
  const storedFont = fonts.normalize(storageData);
  fontFamily.value = storedFont.family;
  fontSize.value = String(storedFont.size);
  function updateFontButtons() {
    const index = fonts.sizes.indexOf(Number(fontSize.value));
    fontSmaller.disabled = index <= 0;
    fontLarger.disabled = index >= fonts.sizes.length - 1;
  }
  async function saveFont() {
    updateFontButtons();
    await chrome.storage.local.set({ resultFontFamily: fontFamily.value, resultFontSize: Number(fontSize.value) });
  }
  function stepFont(direction) {
    const index = fonts.sizes.indexOf(Number(fontSize.value));
    const next = Math.max(0, Math.min(fonts.sizes.length - 1, index + direction));
    fontSize.value = String(fonts.sizes[next]);
    saveFont();
  }
  updateFontButtons();
  fontSmaller.addEventListener('click', () => stepFont(-1));
  fontLarger.addEventListener('click', () => stepFont(1));
  fontFamily.addEventListener('change', saveFont);
  fontSize.addEventListener('change', saveFont);
  document.getElementById('btn-reset-font').addEventListener('click', async () => {
    fontFamily.value = 'system';
    fontSize.value = String(fonts.defaultSize);
    await saveFont();
    showToast('폰트 설정을 초기화했습니다.');
  });

  // Set form controls
  selectTargetLang.value = storageData.targetLang || "ko";
  inputGeminiKey.value = storageData.geminiApiKey || "";
  selectGeminiModel.value = storedModel;

  renderDomainOptions();
  renderDomainList();

  // --- Tab Navigation ---
  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      navTabs.forEach(t => t.classList.remove("active"));
      tabContents.forEach(c => c.classList.remove("active"));
      tab.classList.add("active");
      const targetId = tab.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");
    });
  });

  mainTranslateToggle.addEventListener("change", async () => {
    await chrome.storage.local.set({ selectionEnabled: mainTranslateToggle.checked });
    showToast(mainTranslateToggle.checked ? "드래그 번역 아이콘을 켰습니다." : "드래그 번역 아이콘을 껐습니다.");
  });

  // --- Language Change ---
  selectTargetLang.addEventListener("change", async () => {
    const lang = selectTargetLang.value;
    await chrome.storage.local.set({ targetLang: lang });
    showToast(`번역 언어가 변경되었습니다.`);
  });

  // --- Domain Quick Select & Deselect ---
  selectActiveDomain.addEventListener("change", async () => {
    selectedDomainId = selectActiveDomain.value;
    await chrome.storage.local.set({ selectedDomainId });
    if (selectedDomainId) {
      const p = domainPresets.find(x => x.id === selectedDomainId);
      showToast(`'${p?.name}' 컨텍스트가 적용되었습니다.`);
    } else {
      showToast("컨텍스트 없이 번역합니다.");
    }
  });

  // --- Gemini API Key & Model ---
  inputGeminiKey.addEventListener("change", async () => {
    const val = inputGeminiKey.value.trim();
    await chrome.storage.local.set({ geminiApiKey: val });
  });

  selectGeminiModel.addEventListener("change", async () => {
    const model = selectGeminiModel.value.trim() || globalThis.AI_TRANSLATOR_DEFAULTS.model;
    selectGeminiModel.value = model;
    await chrome.storage.local.set({ geminiModel: model });
  });

  btnToggleKeyVisibility.addEventListener("click", () => {
    const visible = inputGeminiKey.type === "password";
    inputGeminiKey.type = visible ? "text" : "password";
    document.getElementById("key-eye-slash").toggleAttribute("hidden", !visible);
    btnToggleKeyVisibility.setAttribute("aria-pressed", String(visible));
    btnToggleKeyVisibility.title = visible ? "API 키 숨기기" : "API 키 표시";
    btnToggleKeyVisibility.setAttribute("aria-label", btnToggleKeyVisibility.title);
  });

  // Test Gemini API Key
  btnTestGeminiKey.addEventListener("click", async () => {
    const key = inputGeminiKey.value.trim();
    if (!key) {
      showTestResult("API 키를 먼저 입력해주세요.", false);
      return;
    }
    const model = selectGeminiModel.value.trim() || globalThis.AI_TRANSLATOR_DEFAULTS.model;
    showTestResult("연결 테스트 중...", null);
    btnTestGeminiKey.disabled = true;
    try {
      const res = await globalThis.DRAGIT_RUNTIME.send({
        type: "TEST_API_KEY", apiKey: key, model, requestId: crypto.randomUUID()
      });
      if (!res?.success) throw new Error(res?.error || '연결 테스트 응답을 받지 못했습니다.');
      showTestResult(`✓ 연결 성공! (응답: ${res.result})`, true);
    } catch (error) {
      showTestResult(`✗ 실패: ${error.message}`, false);
    } finally {
      btnTestGeminiKey.disabled = false;
    }
  });

  function showTestResult(msg, isSuccess) {
    geminiTestResult.textContent = msg;
    geminiTestResult.className = "test-result-msg";
    if (isSuccess === true) geminiTestResult.classList.add("success");
    if (isSuccess === false) geminiTestResult.classList.add("error");
  }

  // --- Domain Presets Management ---

  function renderDomainOptions() {
    selectActiveDomain.innerHTML = '<option value="">없음</option>';
    domainPresets.forEach(preset => {
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = preset.name;
      if (preset.id === selectedDomainId) {
        opt.selected = true;
      }
      selectActiveDomain.appendChild(opt);
    });
    domainCountBadge.textContent = domainPresets.length;
  }

  function renderDomainList() {
    domainListContainer.innerHTML = "";
    if (domainPresets.length === 0) {
      domainListContainer.innerHTML = `<div class="card-hint text-center">저장된 컨텍스트가 없습니다. + Add로 추가하세요.</div>`;
      return;
    }

    domainPresets.forEach(preset => {
      const card = document.createElement("div");
      card.className = `domain-card-item ${preset.id === selectedDomainId ? 'selected' : ''}`;

      card.innerHTML = `
        <div class="domain-item-top">
          <span class="domain-item-title">${escapeHtml(preset.name)}</span>
          <div class="domain-item-actions">
            <button type="button" class="btn-icon-sm btn-edit" title="수정">✎ 수정</button>
            <button type="button" class="btn-icon-sm delete btn-del" title="삭제">🗑 삭제</button>
          </div>
        </div>
        ${preset.description ? `<p class="domain-item-desc">${escapeHtml(preset.description)}</p>` : ''}
        <div class="domain-item-prompt-snippet" title="${escapeHtml(preset.prompt)}">
          ${escapeHtml(preset.prompt)}
        </div>
      `;

      card.querySelector('.btn-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        openEditDomainModal(preset);
      });

      card.querySelector('.btn-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteDomain(preset.id, preset.name);
      });

      domainListContainer.appendChild(card);
    });
  }

  // Add / Edit Modal
  btnOpenAddDomain.addEventListener("click", () => {
    modalTitle.textContent = "Add context";
    domainFormId.value = "";
    domainFormName.value = "";
    domainFormDesc.value = "";
    domainFormPrompt.value = "";
    domainModal.style.display = "flex";
    domainFormName.focus();
  });

  function openEditDomainModal(preset) {
    modalTitle.textContent = "Edit context";
    domainFormId.value = preset.id;
    domainFormName.value = preset.name;
    domainFormDesc.value = preset.description || "";
    domainFormPrompt.value = preset.prompt;
    domainModal.style.display = "flex";
    domainFormName.focus();
  }

  btnCloseDomainModal.addEventListener("click", closeModal);
  btnCancelDomainModal.addEventListener("click", closeModal);

  function closeModal() {
    domainModal.style.display = "none";
  }

  domainForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = domainFormId.value;
    const name = domainFormName.value.trim();
    const desc = domainFormDesc.value.trim();
    const prompt = domainFormPrompt.value.trim();

    if (!name || !prompt) {
      showToast("Alias와 Context를 입력해주세요.");
      return;
    }

    if (id) {
      // Edit existing
      const idx = domainPresets.findIndex(p => p.id === id);
      if (idx !== -1) {
        domainPresets[idx] = { id, name, description: desc, prompt };
      }
      showToast(`'${name}' 컨텍스트가 수정되었습니다.`);
    } else {
      // Add new
      const newId = "custom_" + Date.now();
      domainPresets.push({ id: newId, name, description: desc, prompt });
      // Automatically select newly added domain
      selectedDomainId = newId;
      showToast(`새 컨텍스트 '${name}'이(가) 등록되고 선택되었습니다.`);
    }

    await chrome.storage.local.set({ domainPresets, selectedDomainId });
    renderDomainOptions();
    renderDomainList();
    closeModal();
  });

  async function deleteDomain(id, name) {
    if (!confirm(`'${name}' 컨텍스트를 삭제하시겠습니까?`)) return;

    domainPresets = domainPresets.filter(p => p.id !== id);
    if (selectedDomainId === id) {
      selectedDomainId = "";
    }

    await chrome.storage.local.set({ domainPresets, selectedDomainId });
    renderDomainOptions();
    renderDomainList();
    showToast(`'${name}' 컨텍스트가 삭제되었습니다.`);
  }

  // --- Status & Helper Functions ---

  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.textContent = msg;
    toastMessage.classList.add("show");
    toastTimer = setTimeout(() => {
      toastMessage.classList.remove("show");
    }, 2500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
});
