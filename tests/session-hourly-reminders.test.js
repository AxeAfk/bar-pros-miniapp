const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hourMs = 60 * 60 * 1000;

function loadApi(initialSession, notifyHourly, notifyOpened = async () => ({ success: true }), employees = {}) {
  let session = { ...initialSession };
  const collection = (name) => ({
    skip() { return this; },
    limit() { return this; },
    async get() {
      return { data: name === 'bar_sessions' && session ? [{ ...session }] : [] };
    },
    doc(id) {
      return {
        async get() {
          if (name === 'bar_employees') return { data: employees[id] || null };
          return { data: name === 'bar_sessions' && id === session.tableId ? { ...session } : null };
        },
        async set({ data }) {
          if (name === 'bar_sessions' && id === session.tableId) {
            session = { ...data };
          }
        }
      };
    }
  });
  const db = {
    collection,
    runTransaction: (callback) => callback({ collection })
  };
  const cloud = {
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: '' }),
    DYNAMIC_CURRENT_ENV: 'test'
  };
  const context = {
    exports: {},
    process: { env: { WECOM_WEBHOOK_URL: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test' } },
    require: (id) => {
      if (id === 'wx-server-sdk') return cloud;
      if (id === './order-notifications') return {
        notifyWecomHourlyReminder: notifyHourly,
        notifyWecomSessionOpened: notifyOpened
      };
      return require(id.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'barApi', id) : id);
    }
  };
  const file = path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return {
    runTimer: () => context.exports.main({ Type: 'Timer', TriggerName: 'sessionHourlyReminder' }),
    getSession: () => session
  };
}

test('hourly timer sends once for the latest full hour on an active table', async () => {
  const calls = [];
  const api = loadApi({
    id: 'S1',
    tableId: 'T01',
    tableName: '1号桌',
    startedAt: Date.now() - (3 * hourMs),
    startedAtText: '2026-10-16 10:00',
    lastHourlyReminderHour: 1
  }, async (...args) => {
    calls.push(args);
    return { success: true };
  });

  const result = await api.runTimer();
  assert.equal(result.success, true);
  assert.equal(result.data.notified, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 3);
  assert.equal(api.getSession().lastHourlyReminderHour, 3);
  assert.equal(api.getSession().hourlyReminderLock, undefined);

  await api.runTimer();
  assert.equal(calls.length, 1);
});

test('failed hourly delivery clears its claim so the next timer run can retry', async () => {
  let attempts = 0;
  const api = loadApi({
    id: 'S2',
    tableId: 'T02',
    tableName: '2号桌',
    startedAt: Date.now() - hourMs,
    startedAtText: '2026-10-16 10:00'
  }, async () => {
    attempts += 1;
    return { success: attempts > 1 };
  });

  const failed = await api.runTimer();
  assert.equal(failed.data.notified, 0);
  assert.equal(api.getSession().lastHourlyReminderHour, undefined);
  assert.equal(api.getSession().hourlyReminderLock, undefined);

  const retried = await api.runTimer();
  assert.equal(retried.data.notified, 1);
  assert.equal(attempts, 2);
  assert.equal(api.getSession().lastHourlyReminderHour, 1);
});

test('timer retries a pending table-opened notification without waiting for an hour', async () => {
  let attempts = 0;
  const api = loadApi({
    id: 'S3',
    tableId: 'T03',
    tableName: '3号桌',
    startedAt: Date.now(),
    startedAtText: '2026-10-16 10:00',
    currentStaffIds: ['E1', 'E2'],
    openedNotificationPending: true
  }, async () => ({ success: true }), async (opened) => {
    attempts += 1;
    assert.deepEqual([...opened.staffNames], ['阿杰', 'E2']);
    return { success: true };
  }, { E1: { id: 'E1', name: '阿杰', active: true } });

  const result = await api.runTimer();
  assert.equal(result.data.notified, 1);
  assert.equal(attempts, 1);
  assert.equal(api.getSession().openedNotificationPending, false);
  assert.ok(api.getSession().openedNotificationSentAt);

  await api.runTimer();
  assert.equal(attempts, 1);
});
