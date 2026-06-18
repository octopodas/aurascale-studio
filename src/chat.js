// AI image chat pane. Talks to /api/ai/* and hands results back to the workspace.
export function initChat({ getCurrentImage, loadResult }) {
  const providerSel = document.getElementById('chat-provider');
  const modelSel = document.getElementById('chat-model');
  const keyStatus = document.getElementById('chat-key-status');
  const messages = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  let providers = [];

  function addMsg(cls, content) {
    const div = document.createElement('div');
    div.className = `chat-msg ${cls}`;
    if (content instanceof Node) div.appendChild(content);
    else div.textContent = content;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function refreshModels() {
    const p = providers.find(p => p.id === providerSel.value);
    modelSel.innerHTML = '';
    (p?.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      modelSel.appendChild(opt);
    });
    const ok = !!p?.keyAvailable;
    keyStatus.textContent = ok ? '✓ API key loaded' : '⚠ No API key — set NANOBANANA_API_KEY';
    keyStatus.classList.toggle('missing', !ok);
    sendBtn.disabled = !ok;
  }

  async function send() {
    const prompt = input.value.trim();
    if (!prompt || sendBtn.disabled) return;
    input.value = '';
    addMsg('user', prompt);
    const pending = addMsg('ai pending', 'Generating…');
    sendBtn.disabled = true;

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerSel.value,
          model: modelSel.value,
          prompt,
          image: getCurrentImage() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      pending.remove();
      const img = document.createElement('img');
      img.src = data.image;
      addMsg('ai', img);
      loadResult(data.image);
    } catch (e) {
      pending.remove();
      addMsg('error', e.message);
    } finally {
      sendBtn.disabled = false;
      refreshModels(); // re-apply key-based disabled state
    }
  }

  providerSel.addEventListener('change', refreshModels);
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  fetch('/api/ai/providers')
    .then(r => r.json())
    .then(list => {
      providers = list;
      providerSel.innerHTML = '';
      list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.label;
        providerSel.appendChild(opt);
      });
      refreshModels();
    })
    .catch(() => {
      keyStatus.textContent = 'AI providers unavailable (dev server only)';
      sendBtn.disabled = true;
    });
}
