/**
 * Urumi AI Chat Agent Frontend Client
 */

(function () {
  'use strict';

  let conversationId = 'conv_' + Date.now();
  let pendingToolDetails = null;

  const messagesContainer = document.getElementById('messages-container');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const gatewayStatusText = document.getElementById('gateway-status-text');
  const modelNameText = document.getElementById('model-name-text');

  // Modal elements
  const modal = document.getElementById('tool-inspector-modal');
  const modalToolTitle = document.getElementById('modal-tool-title');
  const modalUpstreamId = document.getElementById('modal-upstream-id');
  const modalDuration = document.getElementById('modal-duration');
  const modalStatus = document.getElementById('modal-status');
  const modalArgs = document.getElementById('modal-args');
  const modalResult = document.getElementById('modal-result');

  const userSelect = document.getElementById('user-select');
  const storedMemberKey = sessionStorage.getItem('urumi_member_key') || '';
  const storedAdminKey = sessionStorage.getItem('urumi_admin_key') || '';
  const userKeys = {
    user_b_member: storedMemberKey || 'YOUR_MEMBER_API_KEY',
    user_a_admin: storedAdminKey || 'YOUR_ADMIN_API_KEY',
  };
  let activeApiKey = userKeys.user_b_member;

  if (userSelect) {
    userSelect.addEventListener('change', () => {
      const selected = userSelect.value;
      if (selected === 'custom') {
        const customKey = prompt('Enter your raw Urumi API Key:');
        if (customKey && customKey.trim()) {
          activeApiKey = customKey.trim();
          sessionStorage.setItem('urumi_custom_key', activeApiKey);
        } else {
          userSelect.value = 'user_b_member';
          activeApiKey = userKeys.user_b_member;
        }
      } else {
        if (userKeys[selected].startsWith('YOUR_')) {
          const promptLabel = selected === 'user_a_admin' ? 'Admin' : 'Member';
          const enteredKey = prompt(`Enter ${promptLabel} API Key (from cluster gateway-secret):`);
          if (enteredKey && enteredKey.trim()) {
            userKeys[selected] = enteredKey.trim();
            sessionStorage.setItem(selected === 'user_a_admin' ? 'urumi_admin_key' : 'urumi_member_key', enteredKey.trim());
          }
        }
        activeApiKey = userKeys[selected];
      }
      loadStatus();
      appendMessage('assistant', `ℹ️ Switched active persona: <strong>${userSelect.options[userSelect.selectedIndex].text}</strong>. Subsequent tool calls will be authorized and audited under this user.`);
    });
  }

  // Check agent & gateway status on load
  async function loadStatus() {
    try {
      const res = await fetch('/api/agent/status', {
        headers: {
          Authorization: `Bearer ${activeApiKey}`,
        },
      });
      const data = await res.json();
      if (data.gatewayConnected) {
        gatewayStatusText.textContent = `Connected (${data.authenticatedUser?.name || 'Member'}) [${data.authenticatedUser?.role?.toUpperCase() || 'MEMBER'}]`;
      } else {
        gatewayStatusText.textContent = 'Gateway Offline';
        const dot = document.querySelector('.status-dot');
        if (dot) dot.style.backgroundColor = '#f43f5e';
      }

      modelNameText.textContent = data.llmConfigured ? data.model : 'Deterministic Engine';
    } catch {
      gatewayStatusText.textContent = 'Disconnected';
    }
  }

  loadStatus();

  // Reset conversation
  newChatBtn.addEventListener('click', async () => {
    if (confirm('Start a new conversation? Previous messages will be cleared.')) {
      await fetch('/api/chat/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});

      conversationId = 'conv_' + Date.now();
      messagesContainer.innerHTML = `
        <div class="message-row assistant">
          <div class="avatar">🤖</div>
          <div class="message-bubble">
            <p>New conversation started. How can I help you with your WooCommerce store?</p>
          </div>
        </div>
      `;
    }
  });

  // Suggestion & Quick action clicks
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.suggestion-pill, .quick-btn');
    if (btn && btn.dataset.prompt) {
      userInput.value = btn.dataset.prompt;
      submitMessage();
    }
  });

  // Form submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitMessage();
  });

  async function submitMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    userInput.value = '';
    userInput.disabled = true;
    sendBtn.disabled = true;

    // Render user message bubble
    appendMessage('user', text);

    // Render temporary thinking indicator
    const thinkingRow = appendMessage('assistant', 'Thinking and consulting Gateway MCP tools...');
    thinkingRow.classList.add('thinking');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApiKey}`,
        },
        body: JSON.stringify({ message: text, conversationId }),
      });

      const data = await res.json();
      thinkingRow.remove();

      if (!res.ok) {
        appendMessage('assistant', `⚠️ Error: ${data.message || 'Failed to process message'}`);
      } else {
        appendMessage('assistant', data.reply, data.toolsUsed);
      }
    } catch (err) {
      thinkingRow.remove();
      appendMessage('assistant', `⚠️ Connection error: ${err.message}`);
    } finally {
      userInput.disabled = false;
      sendBtn.disabled = false;
      userInput.focus();
    }
  }

  function appendMessage(role, text, toolsUsed = []) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Format Markdown-like bold and bullet points
    const formatted = escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 4px;border-radius:4px;font-family:monospace;">$1</code>')
      .replace(/\n• /g, '<br>• ')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');

    bubble.innerHTML = formatted;

    // Render tools tray if tools were invoked
    if (toolsUsed && toolsUsed.length > 0) {
      const tray = document.createElement('div');
      tray.className = 'tools-tray';

      const trayTitle = document.createElement('div');
      trayTitle.style.fontSize = '11px';
      trayTitle.style.color = '#94a3b8';
      trayTitle.style.fontWeight = '600';
      trayTitle.textContent = `🛠️ Tools Invoked via Gateway (${toolsUsed.length}):`;
      tray.appendChild(trayTitle);

      toolsUsed.forEach((tool, idx) => {
        const item = document.createElement('div');
        item.className = 'tool-indicator-badge';

        const isSuccess = tool.status === 'SUCCESS';
        item.innerHTML = `
          <div class="tool-indicator-left">
            <span>${isSuccess ? '🟢' : '🔴'}</span>
            <span class="tool-name-code">${escapeHtml(tool.name)}</span>
            <span class="upstream-tag">${escapeHtml(tool.upstreamId || 'gateway')}</span>
            <span style="font-size:11px;color:#64748b;">${tool.durationMs}ms</span>
          </div>
          <button class="btn btn-xs btn-outline inspect-tool-btn" data-tool-idx="${idx}">Inspect</button>
        `;

        item.querySelector('.inspect-tool-btn')?.addEventListener('click', () => {
          openInspector(tool);
        });

        tray.appendChild(item);
      });

      bubble.appendChild(tray);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesContainer.appendChild(row);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return row;
  }

  function openInspector(tool) {
    modalToolTitle.textContent = `Tool: ${tool.name}`;
    modalUpstreamId.textContent = tool.upstreamId || 'gateway';
    modalDuration.textContent = `${tool.durationMs}ms`;
    modalStatus.textContent = tool.status;
    modalStatus.style.color = tool.status === 'SUCCESS' ? '#10b981' : '#f43f5e';
    modalArgs.textContent = JSON.stringify(tool.arguments || {}, null, 2);
    modalResult.textContent = tool.resultSnippet || 'No payload recorded';
    modal.classList.add('active');
  }

  window.closeInspector = function () {
    modal.classList.remove('active');
  };

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
