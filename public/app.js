const $ = (selector) => document.querySelector(selector);

const draft = {
  step: 'goal',
  goal: '',
  targetDate: '',
  currentLevel: '',
  constraints: '',
};

function addMessage(role, text) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  $('#messages').appendChild(node);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function nextQuestion(answer) {
  if (draft.step === 'goal') {
    draft.goal = answer;
    draft.step = 'date';
    return 'When do you want to achieve it? Give me a date or say “no fixed deadline.”';
  }
  if (draft.step === 'date') {
    draft.targetDate = answer;
    draft.step = 'level';
    return 'Where are you starting from right now? A sentence is enough.';
  }
  if (draft.step === 'level') {
    draft.currentLevel = answer;
    draft.step = 'constraints';
    return 'What hard constraints must I respect? Say “none” if there are none.';
  }
  draft.constraints = answer;
  draft.step = 'complete';
  return null;
}

function createPlan(goal) {
  const lower = goal.toLowerCase();
  if (lower.includes('marathon') || lower.includes('run')) {
    return {
      directive: 'Complete a 30-minute easy run today.',
      body: 'Keep the pace conversational. Record the activity in your usual fitness app when finished.',
      proof: 'A recorded run of at least 25 minutes',
      milestones: ['Establish a consistent running baseline', 'Build weekly mileage gradually', 'Complete progressively longer runs', 'Finish the peak training block', 'Taper and run the event'],
    };
  }
  return {
    directive: 'Complete the smallest verifiable action that moves this goal forward.',
    body: 'The agent will replace this with a context-aware directive after connected services and Maritime are enabled.',
    proof: 'A verifiable artifact or connected-app event',
    milestones: ['Establish the baseline', 'Define the first measurable milestone', 'Build consistent execution', 'Reach the target threshold', 'Verify the outcome'],
  };
}

function activateDashboard() {
  const plan = createPlan(draft.goal);
  $('#goal-title').textContent = draft.goal;
  $('#directive-title').textContent = plan.directive;
  $('#directive-body').textContent = plan.body;
  $('#directive-proof').textContent = plan.proof;
  $('#directive-deadline').textContent = 'Today, 8:00 PM';
  $('#milestones').innerHTML = plan.milestones.map((item, index) => `<li><span>${index + 1}</span><p>${item}</p></li>`).join('');
  $('#progress-label').textContent = '0%';
  $('#progress-bar').style.width = '0%';
  $('#trajectory').textContent = `Starting point recorded: ${draft.currentLevel}`;
  $('#onboarding').classList.add('hidden');
  $('#dashboard').classList.remove('hidden');
  localStorage.setItem('goalGovernorDraft', JSON.stringify(draft));
}

$('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#chat-input');
  const answer = input.value.trim();
  if (!answer) return;
  addMessage('user', answer);
  input.value = '';
  const response = nextQuestion(answer);
  if (response) {
    setTimeout(() => addMessage('agent', response), 250);
  } else {
    setTimeout(() => {
      addMessage('agent', 'That is enough. I built the first version of your plan and selected today’s action.');
      setTimeout(activateDashboard, 650);
    }, 250);
  }
});

$('#correction-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#correction-input');
  if (!input.value.trim()) return;
  alert('Saved. The production agent will use this correction when replanning.');
  input.value = '';
});

$('#reset').addEventListener('click', () => {
  localStorage.removeItem('goalGovernorDraft');
  location.reload();
});

addMessage('agent', 'What do you want to accomplish?');

