const $ = (selector) => document.querySelector(selector);

const FIRST_MESSAGE = 'What do you want to accomplish?';
let state = { users: [], goals: [], directives: [], evidence: [], penalties: [] };
let activeUserId = localStorage.getItem('goalGovernorUserId');
let onboardingUserId = localStorage.getItem('goalGovernorOnboardingUserId');
let transcript = readTranscript();

function readTranscript() {
  try {
    const parsed = JSON.parse(localStorage.getItem('goalGovernorOnboardingTranscript') || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistTranscript() {
  localStorage.setItem('goalGovernorOnboardingTranscript', JSON.stringify(transcript.slice(-30)));
}

function addMessage(role, text, persist = true) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  $('#messages').appendChild(node);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  if (persist) {
    transcript.push({ role, text });
    transcript = transcript.slice(-30);
    persistTranscript();
  }
}

function renderTranscript() {
  $('#messages').innerHTML = '';
  if (transcript.length === 0) {
    addMessage('agent', FIRST_MESSAGE);
    return;
  }
  for (const message of transcript) addMessage(message.role, message.text, false);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function milestonesFor(goal) {
  const lower = goal.toLowerCase();
  if (lower.includes('marathon') || lower.includes('run')) {
    return ['Establish a verified running baseline', 'Build consistent weekly mileage', 'Complete progressively longer runs', 'Finish the peak training block', 'Taper and complete the race'];
  }
  return ['Establish the baseline', 'Remove the largest immediate bottleneck', 'Complete the first measurable milestone', 'Verify sustained progress', 'Achieve the target outcome'];
}

function renderDashboard() {
  const user = state.users.find((item) => item.id === activeUserId);
  const goal = state.goals.filter((item) => item.userId === activeUserId).at(-1);
  const directive = [...state.directives].reverse().find((item) => item.userId === activeUserId);
  if (!user || !goal) return;

  $('#goal-title').textContent = goal.outcome;
  $('#progress-label').textContent = `${goal.progressPercent || 0}%`;
  $('#progress-bar').style.width = `${goal.progressPercent || 0}%`;
  $('#trajectory').textContent = goal.targetDate ? `Target date: ${goal.targetDate}` : 'The agent is maintaining an adaptive schedule.';
  $('#milestones').innerHTML = milestonesFor(goal.outcome).map((item, index) => `<li><span>${index + 1}</span><p>${item}</p></li>`).join('');

  if (directive) {
    $('#directive-title').textContent = directive.title;
    $('#directive-body').textContent = directive.instruction;
    $('#directive-proof').textContent = directive.evidenceRule?.description || 'Verified completion evidence';
    $('#directive-deadline').textContent = new Date(directive.deadline).toLocaleString();
  } else {
    $('#directive-title').textContent = 'Your agent is preparing the next directive.';
    $('#directive-body').textContent = 'The dashboard will update as soon as the directive is ready.';
  }

  $('#onboarding').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
}

function setChatBusy(busy) {
  const form = $('#chat-form');
  const input = $('#chat-input');
  const button = form.querySelector('button');
  input.disabled = busy;
  button.disabled = busy;
  button.textContent = busy ? (onboardingUserId ? 'Thinking…' : 'Creating agent…') : 'Send';
}

async function finishOnboarding(response) {
  activeUserId = response.userId;
  localStorage.setItem('goalGovernorUserId', activeUserId);
  localStorage.removeItem('goalGovernorOnboardingUserId');
  localStorage.removeItem('goalGovernorOnboardingTranscript');
  onboardingUserId = null;
  transcript = [];
  state = await api('/api/state');
  renderDashboard();
}

$('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#chat-input');
  const answer = input.value.trim();
  if (!answer) return;

  addMessage('user', answer);
  input.value = '';
  setChatBusy(true);

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const response = onboardingUserId
      ? await api(`/api/onboarding/${onboardingUserId}/respond`, {
          method: 'POST',
          body: JSON.stringify({ message: answer, transcript }),
        })
      : await api('/api/onboarding/start', {
          method: 'POST',
          body: JSON.stringify({ goal: answer, timezone, transcript }),
        });

    if (!onboardingUserId) {
      onboardingUserId = response.userId;
      localStorage.setItem('goalGovernorOnboardingUserId', onboardingUserId);
    }

    addMessage('agent', response.message);
    if (response.complete) await finishOnboarding(response);
  } catch (error) {
    addMessage('agent', `Setup paused: ${error.message}`);
  } finally {
    if (!activeUserId) {
      setChatBusy(false);
      input.focus();
    }
  }
});

$('#correction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#correction-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api(`/api/users/${activeUserId}/corrections`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    input.value = '';
    alert('Saved. Your Maritime agent will use this when replanning.');
  } catch (error) {
    alert(error.message);
  }
});

$('#reset').addEventListener('click', () => {
  localStorage.removeItem('goalGovernorUserId');
  localStorage.removeItem('goalGovernorOnboardingUserId');
  localStorage.removeItem('goalGovernorOnboardingTranscript');
  location.reload();
});

async function restore() {
  state = await api('/api/state');
  if (activeUserId && state.users.some((user) => user.id === activeUserId)) {
    renderDashboard();
  }
}

renderTranscript();
restore().catch(() => {});
