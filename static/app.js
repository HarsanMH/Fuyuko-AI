(() => {
  const $ = (id) => document.getElementById(id);
  const input = $("messageInput");
  const messagesEl = $("messages");
  const welcome = $("welcome");
  const sendBtn = $("sendBtn");
  const accessModal = $("accessModal");
  const accessInput = $("accessInput");
  const accessError = $("accessError");
  const toast = $("toast");

  let language = localStorage.getItem("fuyuko-language") || "id";
  let accessCode = sessionStorage.getItem("fuyuko-access-code") || "";
  let busy = false;
  let history = [];
  let installPrompt = null;

  const strings = {
    id: {
      newChat: "Chat baru", specialist: "ASISTEN KHUSUS", install: "Pasang aplikasi",
      privacy: "API key disimpan di server, bukan di aplikasi.",
      bedrockAssistant: "Asisten Bedrock", welcomeTitle: "Apa yang ingin kamu buat?",
      welcomeSubtitle: "Asisten untuk Minecraft Bedrock Add-On.",
      suggestOre: "Buat custom ore", suggestOreSub: "Block, loot table, dan Fortune",
      suggestJson: "Periksa JSON", suggestJsonSub: "Cari kesalahan format",
      suggestScript: "Bantu Script API", suggestScriptSub: "Contoh kode Bedrock",
      suggestRecipe: "Buat recipe", suggestRecipeSub: "Resep crafting add-on",
      placeholder: "Tanya tentang Minecraft Bedrock...", disclaimer: "Fuyuko AI bisa membuat kesalahan. Periksa kode sebelum dipakai.",
      clearChat: "Hapus chat", accessTitle: "Masuk ke Fuyuko AI",
      accessDescription: "Masukkan kode akses aplikasi yang disetel oleh pemilik.",
      continue: "Lanjutkan", wrongCode: "Kode akses salah. Coba lagi.",
      enterCode: "Masukkan kode akses terlebih dahulu.", sending: "Fuyuko AI sedang berpikir…",
      error: "Terjadi kesalahan", copied: "Jawaban disalin.", cleared: "Chat dihapus.",
      language: "Bahasa: Indonesia", confirmClear: "Hapus seluruh chat saat ini?",
      offline: "Kamu sedang offline. Hubungkan internet untuk menggunakan AI.",
      installHint: "Gunakan menu browser ⋮ lalu pilih Tambahkan ke layar utama.",
      copy: "Salin", copyFailed: "Gagal menyalin."
    },
    en: {
      newChat: "New chat", specialist: "SPECIALIST", install: "Install app",
      privacy: "The API key stays on the server, not in the app.",
      bedrockAssistant: "Bedrock assistant", welcomeTitle: "What would you like to build?",
      welcomeSubtitle: "Your assistant for Minecraft Bedrock Add-Ons.",
      suggestOre: "Create a custom ore", suggestOreSub: "Block, loot table, and Fortune",
      suggestJson: "Check JSON", suggestJsonSub: "Find formatting errors",
      suggestScript: "Help with Script API", suggestScriptSub: "Bedrock code examples",
      suggestRecipe: "Create a recipe", suggestRecipeSub: "Add-on crafting recipe",
      placeholder: "Ask about Minecraft Bedrock...", disclaimer: "Fuyuko AI can make mistakes. Review code before using it.",
      clearChat: "Clear chat", accessTitle: "Sign in to Fuyuko AI",
      accessDescription: "Enter the app access code set by the owner.",
      continue: "Continue", wrongCode: "Incorrect access code. Try again.",
      enterCode: "Enter the access code first.", sending: "Fuyuko AI is thinking…",
      error: "Something went wrong", copied: "Answer copied.", cleared: "Chat cleared.",
      language: "Language: English", confirmClear: "Clear the current chat?",
      offline: "You are offline. Connect to the internet to use AI.",
      installHint: "Open browser menu ⋮ and choose Add to Home screen.",
      copy: "Copy", copyFailed: "Could not copy."
    }
  };
  const t = (key) => strings[language][key] || key;

  function applyLanguage() {
    document.documentElement.lang = language;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (strings[language][key]) el.textContent = strings[language][key];
    });
    input.placeholder = t("placeholder");
    $("languageBtn").lastElementChild.textContent = t("language");
    $("accessInput").placeholder = language === "id" ? "Kode akses" : "Access code";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 2800);
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function formatText(text) {
    // Escape HTML first so model output cannot inject markup or scripts.
    let safe = escapeHtml(text);
    safe = safe.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
      (_, lang, code) => `<pre><code>${code.trimEnd()}</code></pre>`);
    safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    return safe;
  }

  function addMessage(role, text, animate = false) {
    const row = document.createElement("div");
    row.className = `message-row ${role}`;
    if (role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "message-avatar";
      avatar.textContent = "F";
      row.appendChild(avatar);
    }
    const content = document.createElement("div");
    content.className = "message-content";
    const body = document.createElement("div");
    body.className = "message-text";
    body.innerHTML = formatText(text);
    content.appendChild(body);

    if (role === "assistant") {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      const copy = document.createElement("button");
      copy.textContent = t("copy");
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          showToast(t("copied"));
        } catch {
          showToast(t("copyFailed"));
        }
      });
      tools.appendChild(copy);
      content.appendChild(tools);
    }
    row.appendChild(content);
    messagesEl.appendChild(row);
    if (animate) row.classList.add("new-message");
    return row;
  }

  function showAccessModal() {
    accessModal.hidden = false;
    accessInput.focus();
  }

  function hideAccessModal() {
    accessModal.hidden = true;
    accessError.hidden = true;
  }

  async function sendMessage(overrideText) {
    if (busy) return;
    const message = (overrideText ?? input.value).trim();
    if (!message) return;
    if (!navigator.onLine) {
      showToast(t("offline"));
      return;
    }
    if (!accessCode) {
      showAccessModal();
      return;
    }

    welcome.hidden = true;
    addMessage("user", message);
    input.value = "";
    resizeInput();
    busy = true;
    sendBtn.disabled = true;
    const waiting = addMessage("assistant", t("sending"));
    waiting.querySelector(".message-text").classList.add("typing");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Password": accessCode,
          "X-App-Language": language
        },
        body: JSON.stringify({ message, history: history.slice(-12) })
      });
      const data = await response.json().catch(() => ({}));
      waiting.remove();

      if (response.status === 401) {
        accessCode = "";
        sessionStorage.removeItem("fuyuko-access-code");
        showAccessModal();
        showToast(t("wrongCode"));
        return;
      }
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : t("error");
        addMessage("assistant", `⚠ ${detail}`);
        return;
      }

      const answer = String(data.answer || "");
      addMessage("assistant", answer);
      history.push({ role: "user", text: message }, { role: "model", text: answer });
      history = history.slice(-12);
    } catch (error) {
      waiting.remove();
      addMessage("assistant", `⚠ ${t("error")}: ${error.message || "Network error"}`);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
      $("chatArea").scrollTo({ top: $("chatArea").scrollHeight, behavior: "smooth" });
    }
  }

  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function newChat() {
    history = [];
    messagesEl.replaceChildren();
    welcome.hidden = false;
    input.value = "";
    resizeInput();
    input.focus();
  }

  $("sendBtn").addEventListener("click", () => sendMessage());
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  $("newChatBtn").addEventListener("click", () => {
    newChat();
    $("sidebar").classList.remove("open");
  });
  $("clearBtn").addEventListener("click", () => {
    if (confirm(t("confirmClear"))) {
      newChat();
      showToast(t("cleared"));
    }
  });
  $("menuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("languageBtn").addEventListener("click", () => {
    language = language === "id" ? "en" : "id";
    localStorage.setItem("fuyuko-language", language);
    applyLanguage();
  });

  $("accessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = accessInput.value.trim();
    if (!code) return;
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "X-App-Password": code }
      });
      if (!response.ok) {
        accessError.textContent = t("wrongCode");
        accessError.hidden = false;
        return;
      }
      accessCode = code;
      // Kept only for this browser tab session, not saved permanently.
      sessionStorage.setItem("fuyuko-access-code", code);
      accessInput.value = "";
      hideAccessModal();
    } catch {
      accessError.textContent = t("error");
      accessError.hidden = false;
    }
  });

  document.querySelectorAll(".suggestion").forEach((button) => {
    button.addEventListener("click", () => {
      const prompts = {
        ore: language === "id"
          ? "Bantu aku membuat custom ore untuk Minecraft Bedrock Add-On. Jelaskan file yang dibutuhkan dan periksa dukungan fitur berdasarkan dokumentasi."
          : "Help me create a custom ore for a Minecraft Bedrock Add-On. Explain required files and verify features against the documentation.",
        json: language === "id"
          ? "Aku ingin memeriksa JSON Minecraft Bedrock. Jelaskan cara memvalidasi JSON dan minta aku mengirim file yang ingin diperiksa."
          : "I want to validate Minecraft Bedrock JSON. Explain how to validate it and ask me to provide the file.",
        script: language === "id"
          ? "Bantu aku membuat fitur dengan Minecraft Bedrock Script API. Tanyakan versi target jika diperlukan dan jangan mengarang API."
          : "Help me build a feature with the Minecraft Bedrock Script API. Ask for the target version if needed and do not invent APIs.",
        recipe: language === "id"
          ? "Buat contoh recipe crafting Minecraft Bedrock Add-On yang valid. Jelaskan lokasi file dan sesuaikan dengan versi target."
          : "Create a valid Minecraft Bedrock Add-On crafting recipe example. Explain the file path and account for the target version."
      };
      sendMessage(prompts[button.dataset.promptId]);
    });
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("installBtn").hidden = false;
  });
  $("installBtn").addEventListener("click", async () => {
    if (!installPrompt) {
      showToast(t("installHint"));
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("installBtn").hidden = true;
  });

  applyLanguage();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  // Only ask for a code if the server says one is required.
  fetch("/api/health").then((r) => r.json()).then((data) => {
    if (data.access_code_required && !accessCode) {
      showAccessModal();
    } else if (!data.access_code_required && !accessCode) {
      // The backend does not require a code; this placeholder is not a secret.
      accessCode = "not-required";
    }
  }).catch(() => {});
})();
