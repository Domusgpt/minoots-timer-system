const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createFakeFirestore,
  configureAdmin,
} = require('./support/fakeFirestore');

const integrations = require('../utils/integrations');
const { __testHooks } = require('../index.js');
const { overrideDb, admin } = __testHooks;

const fakeDb = createFakeFirestore();
overrideDb(fakeDb);
configureAdmin(admin, fakeDb);
integrations.__setDb(fakeDb);

let originalFetch;

beforeEach(() => {
  fakeDb.reset();
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('saving integration masks secrets when listing and delivers slack message', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response('ok', { status: 200 });
  };

  const saved = await integrations.saveIntegration('team-int', 'slack', {
    webhookUrl: 'https://hooks.slack.com/services/AAA/BBB/CCC',
  });
  assert.ok(typeof saved.configuration.webhookPreview === 'string');

  const list = await integrations.listIntegrations('team-int');
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'slack');
  assert.ok(typeof list[0].configuration.webhookPreview === 'string');
  assert.ok(!('webhookUrl' in list[0].configuration));

  const response = await integrations.sendIntegrationNotification('team-int', 'slack', {
    text: 'Hello world',
  });
  assert.ok(response.ok);
  assert.ok(request);
  assert.equal(request.url, 'https://hooks.slack.com/services/AAA/BBB/CCC');
  const body = JSON.parse(request.options.body);
  assert.equal(body.text, 'Hello world');
});

test('email integration posts to sendgrid with authorization header', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response('', { status: 202 });
  };

  await integrations.saveIntegration('team-mail', 'email', {
    provider: 'sendgrid',
    apiKey: 'SG.test-key',
    from: 'no-reply@example.com',
    to: 'alerts@example.com',
  });

  const response = await integrations.sendIntegrationNotification('team-mail', 'email', {
    subject: 'Timer Alert',
    text: 'A timer has completed.',
  });
  assert.ok(response.ok);
  assert.ok(request);
  assert.equal(request.url, 'https://api.sendgrid.com/v3/mail/send');
  assert.equal(request.options.headers.Authorization, 'Bearer SG.test-key');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.personalizations[0].to[0].email, 'alerts@example.com');
});

test('twilio sms and voice integrations use basic auth form posts', async () => {
  let smsRequest;
  let voiceRequest;
  let callIndex = 0;
  global.fetch = async (url, options) => {
    callIndex += 1;
    if (callIndex === 1) {
      smsRequest = { url, options };
    } else {
      voiceRequest = { url, options };
    }
    return new Response('', { status: 201 });
  };

  await integrations.saveIntegration('team-twilio', 'sms', {
    accountSid: 'AC123',
    authToken: 'secret',
    from: '+10000000000',
    to: '+12223334444',
  });

  await integrations.saveIntegration('team-twilio', 'voice', {
    accountSid: 'AC123',
    authToken: 'secret',
    from: '+10000000000',
    to: '+13334445555',
  });

  await integrations.sendIntegrationNotification('team-twilio', 'sms', { text: 'SMS ready' });
  await integrations.sendIntegrationNotification('team-twilio', 'voice', { text: 'Voice ready' });

  const expectedAuth = `Basic ${Buffer.from('AC123:secret').toString('base64')}`;
  assert.ok(smsRequest.url.includes('/Messages.json'));
  assert.equal(smsRequest.options.headers.Authorization, expectedAuth);
  const smsParams = new URLSearchParams(smsRequest.options.body);
  assert.equal(smsParams.get('Body'), 'SMS ready');

  assert.ok(voiceRequest.url.includes('/Calls.json'));
  assert.equal(voiceRequest.options.headers.Authorization, expectedAuth);
  const voiceParams = new URLSearchParams(voiceRequest.options.body);
  assert.equal(voiceParams.get('Twiml')?.includes('Voice ready'), true);
});
