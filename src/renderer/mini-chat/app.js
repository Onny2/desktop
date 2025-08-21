const el = (id) => document.getElementById(id);
const msgsEl = el("msgs");
const statusEl = el("status");
const inputEl = el("prompt");
const btnSend = el("send");
const btnRefresh = el("refresh");
const btnNew = el("newChat");
const modelInput = el("modelInput");
const modelsList = el("models");
const errBox = el("err");

// Modal API key
const setupModal = el("setup");
const apiKeyInput = el("apiKeyInput");
const saveKeyBtn = el("saveKey");
const cancelKeyBtn = el("cancelKey");
const keyBtn = el("keyBtn");
let BASE = null;        // es. http://127.0.0.1:8080
let API_KEY = "";       // salvata in localStorage
let MODELS = [];
let history = [];       // [{role, content}]
let chatId = null;      // id chat su Open WebUI

// ----------------- util -----------------
const nowMs = () => Date.now();
const uuid = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
function setStatus(t) { statusEl.textContent = t || ""; }
function showErr(t) { errBox.textContent = t || ""; }
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
function processAssistantMessage(text) {
    let html = escapeHtml(text);
    // code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const codeEsc = escapeHtml(code);
        const langClass = lang ? ` class="lang-${lang}"` : '';
        return `<div class="code-block"><button class="copy-btn">Copy</button><pre><code${langClass}>${codeEsc}</code></pre></div>`;
    });
    // thinking collapsible
    html = html.replace(/&lt;thinking&gt;([\s\S]*?)&lt;\/thinking&gt;/g, (_, inner) => {
        const innerEsc = escapeHtml(inner.trim());
        return `<details class="thinking"><summary>Thinking</summary><pre><code>${innerEsc}</code></pre></details>`;
    });
    // line breaks
    html = html.replace(/\r\n|\r|\n/g, '<br>');
    return html;
}
function attachCopyButtons(container) {
    container.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const codeEl = btn.nextElementSibling.querySelector('code');
            const txt = codeEl.innerText;
            navigator.clipboard.writeText(txt)
                .then(() => {
                    btn.textContent = 'Copied!';
                    setTimeout(() => btn.textContent = 'Copy', 1500);
                })
                .catch(() => {
                    btn.textContent = 'Error';
                    setTimeout(() => btn.textContent = 'Copy', 1500);
                });
        });
    });
}
function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "u" : "a");
    if (role === "assistant") {
        div.innerHTML = processAssistantMessage(text);
        attachCopyButtons(div);
    } else {
        div.textContent = text;
    }
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
}
function addTyping() {
    const div = document.createElement("div");
    div.className = "msg a";
    div.innerHTML = `<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
}
function removeNode(n) { if (n && n.parentNode) n.parentNode.removeChild(n); }
function normalizeBase(u) {
    if (!u) return null;
    let s = u.trim();
    if (!/^https?:\/\//.test(s)) s = "http://" + s;
    s = s.replace(/\/+$/, "");
    if (s.startsWith("http://0.0.0.0")) s = s.replace("http://0.0.0.0", "http://localhost");
    return s;
}
// ----------------- API key -----------------
function loadApiKey() { try { const k = localStorage.getItem("quickchat_api_key"); if (k) API_KEY = k; } catch {} }
function saveApiKey(k) { API_KEY = (k||"").trim(); if (API_KEY) localStorage.setItem("quickchat_api_key", API_KEY); }
function ensureApiKey() { if (!API_KEY) openKeyModal(); }
function openKeyModal() { apiKeyInput.value = API_KEY || ""; setupModal.classList.add("show"); setTimeout(()=>apiKeyInput.focus(),0); }
function closeKeyModal() { setupModal.classList.remove("show"); }
// ----------------- reachability -----------------
async function isReachable(url) {
    const probes = ["/_app/version.json","/api/health","/"];
    for (const p of probes) {
        try { const r = await fetch(url+p,{credentials:"include"}); if (r.ok) return true; } catch {}
    }
    return false;
}
async function autodetectBase(ports=[8080]) {
    const hosts = ["127.0.0.1","localhost"];
    for (const h of hosts) for (const port of ports) {
        const c = `http://${h}:${port}`;
        if (await isReachable(c)) return c;
    }
    return null;
}
// ----------------- bootstrap -----------------
async function loadInfo() {
    try { const info = await window.quickChat?.info?.(); BASE = normalizeBase(info?.baseUrl||""); }
    catch { BASE = null; }
    if (!BASE || !(await isReachable(BASE))) BASE = await autodetectBase([8080]);
    setStatus(BASE ? `Connected to ${BASE}` : "Server not running");
}
// ----------------- models -----------------
function setModelsInUI() {
    modelsList.innerHTML = "";
    if (!MODELS.length) { modelInput.placeholder = "model (type manually, e.g. 'llama3:8b')"; return; }
    for (const m of MODELS) {
        const opt = document.createElement("option");
        opt.value = m.id;
        modelsList.appendChild(opt);
    }
    if (!modelInput.value && MODELS[0]?.id) modelInput.value = MODELS[0].id;
}
async function fetchModels() {
    MODELS = []; setModelsInUI(); showErr("");
    if (!BASE) return;
    if (!API_KEY) { ensureApiKey(); return; }
    const headers = { "Authorization": `Bearer ${API_KEY}` };
    const candidates = ["/api/models","/v1/models","/api/tags"];
    for (const p of candidates) {
        try {
            const res = await fetch(BASE+p,{credentials:"include",headers});
            if (!res.ok) { const t = await res.text().catch(()=> ""); showErr(`GET ${p} → ${res.status}\n${t}`); continue; }
            const data = await res.json();
            if (Array.isArray(data?.data)) MODELS = data.data.map(m=>({id:m.id||m.name||m.tag})).filter(Boolean);
            else if (Array.isArray(data))   MODELS = data.map(m=>({id:m.id||m.name||m.tag})).filter(Boolean);
            else if (data?.models && Array.isArray(data.models)) MODELS = data.models.map(m=>({id:m.id||m.name||m.tag})).filter(Boolean);
            if (MODELS.length) break;
        } catch { showErr(`GET ${p} → network error`); }
    }
    setModelsInUI();
}
// ----------------- persistenza compatibile UI -----------------
// 1) crea una chat con il messaggio user
async function createChatWithUserMessage(model, userText) {
    const userId = uuid();
    const body = {
        chat: {
            title: "New Chat",
            models: [model],
            messages: [{
                id: userId, role: "user", content: userText,
                timestamp: nowMs(), models: [model]
            }]
        }
    };
    const res = await fetch(BASE + "/api/v1/chats/new", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        credentials: "include",
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST /api/v1/chats/new → ${res.status} ${await res.text().catch(()=> "")}`);
    const data = await res.json();
    return { chatId: data?.chat?.id || data?.id || null };
}
// 2) completa via /api/chat/completions (NO streaming) — server salva nel thread
async function requestCompletion(chatId, model, messages) {
    const res = await fetch(BASE + "/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
        credentials: "include",
        body: JSON.stringify({
            chat_id: chatId,
            model,
            messages,
            stream: false,
        })
    });
    if (!res.ok) throw new Error(`POST /api/chat/completions → ${res.status} ${await res.text().catch(()=> "")}`);
    try {
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content || data?.message || data?.content || null;
        return text;
    } catch {
        return null;
    }
}
// 3) leggi il thread finché non compare la risposta assistant
async function fetchAssistantText(chatId, timeoutMs = 60000, intervalMs = 900) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const r = await fetch(`${BASE}/api/v1/chats/${chatId}`, {
            headers: { "Authorization": `Bearer ${API_KEY}` },
            credentials: "include"
        });
        if (!r.ok) throw new Error(`GET /api/v1/chats/${chatId} → ${r.status}`);
        const data = await r.json();
        const msgs = data?.chat?.messages || data?.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (m.role === "assistant" && m.content && String(m.content).trim() !== "") {
                return String(m.content);
            }
        }
        await new Promise(res => setTimeout(res, intervalMs));
    }
    throw new Error("Timeout while waiting for assistant reply");
}
// ----------------- UI actions -----------------
async function startNewChat() {
    chatId = null;
    history = [];
    msgsEl.innerHTML = "";
    showErr("");
}
async function sendPrompt() {
    const text = inputEl.value.trim();
    const model = (modelInput.value || "").trim();
    showErr("");
    if (!text) return;
    if (!BASE) { addMsg("assistant", "Server not running. Press ↻."); return; }
    if (!API_KEY) { ensureApiKey(); return; }
    if (!model) { addMsg("assistant", "Select or type a model name."); return; }
    addMsg("user", text);
    history.push({ role: "user", content: text });
    inputEl.value = "";
    if (!chatId) {
        try {
            const created = await createChatWithUserMessage(model, text);
            chatId = created.chatId;
        } catch (e) {
            showErr(String(e));
            addMsg("assistant", "(error creating chat)");
            return;
        }
    }
    const typing = addTyping();
    try {
        const maybeText = await requestCompletion(chatId, model, history);
        const reply = maybeText ?? await fetchAssistantText(chatId);
        removeNode(typing);
        addMsg("assistant", reply);
        history.push({ role: "assistant", content: reply });
    } catch (e) {
        removeNode(typing);
        showErr(String(e));
        addMsg("assistant", "(error)");
    }
}
async function reconnect() {
    setStatus("Reconnecting…");
    showErr("");
    await loadInfo();
    if (BASE) await fetchModels();
}
// ----------------- init -----------------
async function init() {
    loadApiKey();
    await loadInfo();
    if (BASE) await fetchModels();
    if (!API_KEY) ensureApiKey();
    try {
        const pasted = window.quickChat?.paste?.();
        if (pasted && pasted.length < 4000) inputEl.value = pasted;
    } catch {}
}
// UI events
btnSend.addEventListener("click", sendPrompt);
inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendPrompt();
    }
});
btnRefresh.addEventListener("click", reconnect);
btnNew.addEventListener("click", startNewChat);
keyBtn.addEventListener("click", openKeyModal);
saveKeyBtn.addEventListener("click", () => { saveApiKey(apiKeyInput.value); closeKeyModal(); reconnect(); });
cancelKeyBtn.addEventListener("click", () => { closeKeyModal(); });
init();