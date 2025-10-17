const express = require('express');
const crypto = require('crypto');

const app = express();
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});
app.use(express.urlencoded({ extended: true }));

const MINOOTS_BASE_URL = process.env.MINOOTS_BASE_URL || 'https://api-m3waemr5lq-uc.a.run.app';
const MINOOTS_API_KEY = process.env.MINOOTS_API_KEY;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

if (!MINOOTS_API_KEY) {
  console.warn('Warning: MINOOTS_API_KEY is not set. Slash command will fail to schedule timers.');
}

function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) {
    console.warn('Missing SLACK_SIGNING_SECRET – skipping verification');
    return true;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (Number(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${req.rawBody || ''}`;
  const hmac = crypto
    .createHmac('sha256', SLACK_SIGNING_SECRET)
    .update(sigBasestring, 'utf8')
    .digest('hex');
  const expected = `v0=${hmac}`;
  if (expected.length !== signature.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function scheduleTimer(duration, note, slackBody) {
  const response = await fetch(`${MINOOTS_BASE_URL}/quick/wait`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'slack-slash-command/minoots',
      'x-api-key': MINOOTS_API_KEY,
    },
    body: JSON.stringify({
      duration,
      name: note || `slack_${slackBody.user_name || 'user'}`,
      agent_id: slackBody.user_id,
      team: slackBody.team_id,
      metadata: {
        channel: slackBody.channel_name,
        channel_id: slackBody.channel_id,
        slack_user: slackBody.user_id,
        request: slackBody.text,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to schedule timer: ${response.status} ${text}`);
  }
  return response.json();
}

async function pollTimer(timerId) {
  while (true) {
    const response = await fetch(`${MINOOTS_BASE_URL}/timers/${timerId}`, {
      headers: {
        'user-agent': 'slack-slash-command/minoots',
        'x-api-key': MINOOTS_API_KEY,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to poll timer ${timerId}: ${response.status} ${text}`);
    }
    const json = await response.json();
    const timer = json.timer || {};
    const status = (timer.status || '').toLowerCase();
    const remaining = typeof timer.timeRemaining === 'number' ? timer.timeRemaining : Number.MAX_VALUE;
    if (['expired', 'completed', 'settled', 'cancelled'].includes(status) || remaining <= 0) {
      return timer;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

app.post('/slack/commands', async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send('invalid signature');
  }

  const { text = '', response_url: responseUrl } = req.body;
  const [durationRaw, ...rest] = text.trim().split(/\s+/);
  const duration = durationRaw || '30s';
  const note = rest.join(' ');

  if (!MINOOTS_API_KEY) {
    return res.json({ response_type: 'ephemeral', text: 'MINOOTS API key missing on server.' });
  }

  res.json({ response_type: 'ephemeral', text: `⏱️ Scheduling MINOOTS timer for ${duration}...` });

  try {
    const quick = await scheduleTimer(duration, note, req.body);
    const timer = quick.timer || {};
    const timerId = timer.id;
    if (!timerId) {
      throw new Error('Timer response missing id');
    }

    const finalTimer = await pollTimer(timerId);
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response_type: 'in_channel',
          text: `⏱️ Timer ${finalTimer.name || timerId} settled with status *${finalTimer.status}*`,
        }),
      });
    }
  } catch (error) {
    console.error(error);
    if (responseUrl) {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: `⚠️ Failed to run timer: ${error.message}`,
        }),
      });
    }
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`MINOOTS Slack slash command listening on ${port}`);
});

module.exports = app;
