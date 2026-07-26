const $ = (selector) => document.querySelector(selector);
let state = { users: [], goals: [], directives: [], evidence: [], penalties: [] };

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function dollars(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

async function load() {
  state = await api('/api/state');
  render();
}

function render() {
  $('#goal-user').innerHTML = state.users.length
    ? state.users.map((u) => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('')
    : '<option value="">Create a person first</option>';

  $('#people').innerHTML = state.users.length ? state.users.map((user) => {
    const goals = state.goals.filter((g) => g.userId === user.id);
    return `<article class="card">
      <span class="pill">${escapeHtml(user.notificationChannel)}</span>
      <h3>${escapeHtml(user.name)}</h3>
      <p class="meta">${escapeHtml(user.timezone)} · command at ${escapeHtml(user.morningTime)}</p>
      <p><strong>Commitment balance:</strong> ${dollars(user.stakeBalanceCents)}</p>
      <p><strong>Agent:</strong> ${escapeHtml(user.maritimeAgentName || 'not provisioned yet')}</p>
      ${goals.map((goal) => `<div>
        <p><strong>${escapeHtml(goal.outcome)}</strong></p>
        <div class="progress"><span style="width:${goal.progressPercent}%"></span></div>
        <p class="meta">${goal.progressPercent}% inferred progress${goal.targetDate ? ` · target ${goal.targetDate}` : ''}</p>
      </div>`).join('') || '<p class="empty">No active goal.</p>'}
      <div class="actions"><button data-run="${user.id}">Generate today’s directive</button></div>
    </article>`;
  }).join('') : '<p class="empty">Create a person and a goal.</p>';

  $('#directives').innerHTML = state.directives.length ? [...state.directives].reverse().map((d) => {
    const user = state.users.find((u) => u.id === d.userId);
    return `<article class="card">
      <span class="pill ${d.status}">${d.status}</span>
      <h3>${escapeHtml(d.title)}</h3>
      <p class="meta">${escapeHtml(user?.name || '')} · due ${new Date(d.deadline).toLocaleString()}</p>
      <pre>${escapeHtml(d.instruction)}</pre>
      <p><strong>Proof:</strong> ${escapeHtml(d.evidenceRule.description)}</p>
      <p><strong>Why:</strong> ${escapeHtml(d.whyThis)}</p>
      <p><strong>Consequence:</strong> ${dollars(d.penaltyCents)}</p>
      ${d.status === 'active' ? `<div class="actions">
        <button class="secondary" data-complete="${d.id}">Submit valid proof</button>
        <button class="danger" data-fail="${d.id}">Simulate missed deadline</button>
      </div>` : ''}
    </article>`;
  }).join('') : '<p class="empty">No directives yet.</p>';

  $('#penalties').innerHTML = state.penalties.length ? [...state.penalties].reverse().map((p) => {
    const user = state.users.find((u) => u.id === p.userId);
    return `<article class="card">
      <span class="pill ${p.status === 'deducted' ? 'failed' : ''}">${escapeHtml(p.status)}</span>
      <h3>${dollars(p.amountCents)}</h3>
      <p>${escapeHtml(p.reason)}</p>
      <p class="meta">${escapeHtml(user?.name || '')} · ${new Date(p.createdAt).toLocaleString()}</p>
    </article>`;
  }).join('') : '<p class="empty">No consequences applied.</p>';
}

$('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        phone: form.get('phone'),
        timezone: form.get('timezone'),
        morningTime: form.get('morningTime'),
        notificationChannel: form.get('notificationChannel'),
        boundaries: String(form.get('boundaries') || '').split('\n').map((x) => x.trim()).filter(Boolean),
        weeklyBudgetDollars: Number(form.get('budget')),
        penaltyPerFailureDollars: Number(form.get('penalty')),
        weeklyPenaltyCapDollars: Number(form.get('cap')),
        stakeBalanceDollars: Number(form.get('balance')),
      }),
    });
    event.currentTarget.reset();
    await load();
  } catch (error) { alert(error.message); }
});

$('#goal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify({ userId: form.get('userId'), outcome: form.get('outcome'), targetDate: form.get('targetDate') }),
    });
    event.currentTarget.reset();
    await load();
  } catch (error) { alert(error.message); }
});

document.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  try {
    if (target.dataset.run) {
      target.setAttribute('disabled', 'true');
      target.textContent = 'Agent is deciding…';
      await api(`/api/run/morning/${target.dataset.run}`, { method: 'POST' });
      await load();
    }
    if (target.dataset.complete) {
      const directive = state.directives.find((d) => d.id === target.dataset.complete);
      const source = directive?.evidenceRule.type || 'manual';
      await api(`/api/directives/${target.dataset.complete}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          source,
          note: 'Demo completion proof',
          numericValue: directive?.evidenceRule.minValue || 1,
          url: source === 'url' || source === 'github_commit' ? 'https://example.com/proof' : '',
          accepted: true,
        }),
      });
      await load();
    }
    if (target.dataset.fail) {
      await api(`/api/directives/${target.dataset.fail}/force-deadline`, { method: 'POST' });
      await load();
    }
  } catch (error) {
    alert(error.message);
    await load();
  }
});

$('#refresh').addEventListener('click', load);
load();
