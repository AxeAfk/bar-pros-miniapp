const assert = require('node:assert/strict');
const { test } = require('node:test');
const { notifyAdmins } = require('../cloudfunctions/barApi/order-notifications');
const { orderNotificationTemplateId } = require('../config/app');

const order = {
  id: 'O1', tableName: '1号桌', source: 'customer',
  createdAtText: '2026-10-16 00:25',
  items: [{ name: '百威啤酒', quantity: 2 }, { name: '科罗娜', quantity: 1 }]
};

test('new orders notify each distinct configured admin using the approved fields', async () => {
  const calls = [];
  const cloud = { openapi: { subscribeMessage: {
    send: async (payload) => { calls.push(payload); return { errCode: 0 }; }
  } } };
  const result = await notifyAdmins(cloud, order, ' admin1,admin2,admin1, ');
  assert.equal(calls.length, 2);
  assert.ok(result.every((entry) => entry.success));
  assert.deepEqual(calls.map((entry) => entry.touser), ['admin1', 'admin2']);
  assert.equal(calls[0].templateId, orderNotificationTemplateId);
  assert.equal(calls[0].page, 'pages/admin/admin');
  assert.deepEqual(calls[0].data, {
    thing1: { value: '百威啤酒×2、科罗娜×1' },
    time2: { value: order.createdAtText },
    thing6: { value: '1号桌顾客' }
  });
});

test('unsubscribed admins do not prevent other deliveries or fail a committed order', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const cloud = { openapi: { subscribeMessage: {
    send: async ({ touser }) => {
      if (touser === 'a') throw new Error('No consent');
      if (touser === 'b') return { errCode: 43101, errMsg: 'Consent exhausted' };
      return { errCode: 0 };
    }
  } } };
  const result = await notifyAdmins(cloud, order, 'a,b,c');
  assert.deepEqual(result.map((entry) => entry.success), [false, false, true]);
  assert.equal(logs.length, 2);
});

test('long summaries fit thing fields and missing recipients are logged', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  let payload;
  const cloud = { openapi: { subscribeMessage: {
    send: async (data) => { payload = data; return { errCode: 0 }; }
  } } };
  await notifyAdmins(cloud, { ...order, source: 'admin', items: Array(10).fill(order.items[0]) }, 'a');
  assert.equal(Array.from(payload.data.thing1.value).length, 20);
  assert.equal(payload.data.thing6.value, '1号桌（代客）');
  assert.deepEqual(await notifyAdmins(cloud, order, ''), []);
  assert.equal(logs.length, 1);
});
