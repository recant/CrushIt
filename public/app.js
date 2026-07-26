const $ = (selector) => document.querySelector(selector);

const questions = [
  { key: 'goal', text: 'What do you want to accomplish?' },
  { key: 'targetDate', text: 'When do you want to achieve it? Give me a date or say “no fixed deadline.”' },
  { key: 'currentLevel', text: 'Where are you starting from right now? A sentence is enough.' },
  { key: 'constraints', text: 'What hard constraints must I respect? Say “none” if there are none.' },
  { key: 'phone', text: 'What phone number should receive the daily text? Include the country code, like +16175551234. Say “skip” to use email only.' },
  { key: 'email', text: 'What email address should receive the daily directive? Say “skip” to use text only.' },
  { key: 'morningTime', text: 'What time should the daily directive arrive? Use 24-hour time, such as 07:00.' },
];

const draft = { step: 0, goal: '', targetDate: '', currentLevel: '', constraints: '', phone: '', email: '', morningTime: '07:00' };
let state = { users: [], goals: [], directives: [], evidence: [], penalties: [] };
let activeUserId = localStorage.getItem('goalGovernorUserId');

function addMessage(role, text) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  $('#messages').appendChild(node);
  $('#messages').scrollTop = $('#messages').scrollHeight;
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

function normalizeOptional(value) {
  return /^skip|none|no$/i.test(value.trim()) ? '' : value.trim();
}

function parseTargetDate(value) {
  if (/no fixed|none|skip|choose/i.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
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
  }

  $('#onboarding').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
}

async function activateGoal() {
  const phone = normalizeOptional(draft.phone);
  const email = normalizeOptional(draft.email);
  if (!phone && !email) throw new Error('Enter at least a phone number or email address.');

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  const user = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({
      name: 'User',
      phone,
      email,
      timezone,
      morningTime: /^\d{2}:\d{2}$/.test(draft.morningTime) ? draft.morningTime : '07:00',
      notificationChannel: 'maritime',
      boundaries: /^none$/i.test(draft.constraints.trim()) ? [] : [draft.constraints, `Starting point: ${draft.currentLevel}`],
      weeklyBudgetDollars: 0,
      penaltyPerFailureDollars: 5,
      weeklyPenaltyCapDollars: 20,
      stakeBalanceDollars: 50,
    }),
  });

  activeUserId = user.id;
  localStorage.setItem('goalGovernorUserId', activeUserId);

  await api('/api/goals', {
    method: 'POST',
    body: JSON.stringify({ userId: user.id, outcome: draft.goal, targetDate: parseTargetDate(draft.targetDate) }),
  });

  addMessage('agent', 'I have enough. I’m provisioning your personal Maritime agent, building today’s plan, and sending the first directive now.');
  await api(`/api/run/morning/${user.id}`, { method: 'POST' });
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

  const current = questions[draft.step];
  draft[current.key] = answer;
  draft.step += 1;

  if (draft.step < questions.length) {
    setTimeout(() => addMessage('agent', questions[draft.step].text), 200);
    return;
  }

  input.disabled = true;
  event.currentTarget.querySelector('button').disabled = true;
  try {
    await activateGoal();
  } catch (error) {
    addMessage('agent', `I could not activate the agent: ${error.message}`);
    input.disabled = false;
    event.currentTarget.querySelector('button').disabled = false;
  }
});

$('#correction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#correction-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api(`/api/users/${activeUserId}/corrections`, { method: 'POST', body: JSON.stringify({ text }) });
    input.value = '';
    alert('Saved. Your Maritime agent will use this when replanning.');
  } catch (error) {
    alert(error.message);
  }
});

$('#reset').addEventListener('click', () => {
  localStorage.removeItem('goalGovernorUserId');
  location.reload();
});

async function restore() {
  state = await api('/api/state');
  if (activeUserId && state.users.some((user) => user.id === activeUserId)) renderDashboard();
}

addMessage('agent', questions[0].text);
restore().catch(() => {});
