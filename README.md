# CrushIt

A runnable MVP for a near-zero-input goal agent:

- The user states an outcome once.
- The backend idempotently provisions one persistent Maritime/OpenClaw Identity agent for that user.
- Each morning, the agent inspects connected context and chooses one concrete action.
- The app sends the directive through Maritime WhatsApp/Telegram, Twilio SMS, Resend email, or the console.
- Evidence is checked deterministically.
- Missed deadlines deduct from a simulated, capped commitment balance.

This is a hackathon-grade prototype, not a production financial product. It does **not** charge a real card. The enforcement ledger deliberately uses prepaid simulated dollars so an LLM can never create a real charge.

## Architecture

```text
Browser dashboard
      |
Express API + JSON store + scheduler
      |
Maritime SDK
      |
One isolated OpenClaw Identity agent per user
      |-- Google Calendar / Gmail / Drive
      |-- browser and web research
      `-- WhatsApp / Telegram delivery

Evidence webhook --> deterministic verifier --> commitment ledger
```

The model chooses the action. Ordinary code controls identity, deadlines, evidence, caps, balances, and consequences.

## 1. Install prerequisites

Use Node.js 22 or newer. Maritime's CLI itself supports Node 18+, but OpenClaw currently recommends a newer Node release.

```bash
node --version
npm --version
npm install -g maritime-cli
```

Create or sign into a Maritime account:

```bash
maritime login
maritime whoami
```

Mint a long-lived backend key. The raw key is shown only once:

```bash
maritime keys create --name goal-governor-dev --json
```

The key needs `provision` and `deploy` capabilities because the app creates agents and chats with them.

## 2. Configure the project

```bash
cp .env.example .env
```

Open `.env` and set:

```dotenv
MARITIME_API_KEY=mk_your_real_key
DEMO_MODE=false
```

Then install and run:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

For a UI-only test without Maritime, leave `DEMO_MODE=true` and use **Console demo** delivery. The generated action will be generic because it cannot inspect Google or browse through the agent.

## 3. Create your first user and agent

In the dashboard:

1. Create a person.
2. Select `Console demo` initially.
3. Add one outcome, such as `Find and speak to three healthcare founders this week.`
4. Click **Generate today's directive**.

The first real run provisions an agent named approximately:

```text
goal-governor-userxxxxxxxx
```

Inspect it:

```bash
maritime list
maritime open <agent-name>
```

The provisioning call is idempotent on the app's user ID, so restarting or signing in again does not create duplicate agents.

## 4. Give the agent life context

Open the agent in Maritime, then go to **Integrations**.

Each OpenClaw Identity agent already receives its own SMS-capable US phone number, email address, and tunnel. New numbers can need roughly 10–15 minutes before outbound SMS is ready, and the recipient may need to reply `START`.

Connect:

- **Google Workspace** for Calendar, Gmail, Drive, Docs, and Sheets.
- **WhatsApp** or **Telegram** for proactive delivery.

Set that person's delivery setting to `maritime`. The app asks the personal OpenClaw Identity agent to send the exact directive using its own SMS/email tools; WhatsApp or Telegram can be connected as fallbacks.

The planning prompt explicitly tells the agent to inspect connected calendar/email and browse for time-sensitive opportunities before choosing today's action.

## 5. Optional direct SMS or email

### Twilio SMS

Add:

```dotenv
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...
```

Then select `sms` for the user and provide an E.164 phone number such as `+16175551234`.

### Resend email

Add:

```dotenv
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Goal Governor <you@your-verified-domain.com>
```

Then select `email` and provide the user's email address.

## 6. How daily scheduling works

The included scheduler checks each person's local time and runs once when it equals their configured morning time. It uses the person's IANA timezone, such as `America/New_York`.

For a local demo, this is enough. In production, deploy the web backend to a continuously available service or replace the polling scheduler with a durable job queue.

Maritime agents automatically sleep when idle and wake when `maritime.agents.chat(...)` is called, so the expensive personal agent does not need to remain continuously active.

## 7. Test evidence and consequences

After creating a directive, the dashboard provides:

- **Submit valid proof**: generates evidence matching the directive's rule and marks it complete.
- **Simulate missed deadline**: moves its deadline into the past, evaluates it, and deducts from the simulated commitment balance.

External services can submit evidence to:

```text
POST /api/webhooks/evidence/:directiveId
X-Goal-Governor-Secret: <APP_WEBHOOK_SECRET>
Content-Type: application/json
```

Example Strava-style payload:

```json
{
  "source": "strava_distance_km",
  "numericValue": 5.2,
  "note": "Morning run",
  "accepted": true
}
```

Example GitHub payload:

```json
{
  "source": "github_commit",
  "url": "https://github.com/you/repo/commit/abc123",
  "accepted": true
}
```

For outside webhooks during local development, expose port 3000 with a tunnel and set `APP_BASE_URL` to that HTTPS address.

## Important files

```text
src/maritime.ts    per-user provisioning, prompts, Maritime delivery
src/core.ts        daily closed loop
src/enforcement.ts deterministic verification and capped penalties
src/scheduler.ts   timezone-aware morning and deadline checks
src/server.ts      API routes
public/            zero-build dashboard
data/store.json    local prototype database
```

## What to improve next

The first serious upgrade should be a real evidence adapter for one narrow vertical. For example, build only for running and connect Strava, or build only for startup execution and connect Calendar, Gmail, GitHub, and event-registration receipts. General-purpose verification is the hardest part of the company.

Before handling real money, replace the ledger only after implementing explicit commitment contracts, payment authorization, grace periods, disputes, charge caps, audit logs, age restrictions, and legal review. Do not let the agent call a payment API directly.
