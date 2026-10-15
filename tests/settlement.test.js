const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadApi() {
  const now = Date.now();
  let session = {
    id: 'S1',
    tableId: 'T01',
    tableName: 'Table 1',
    startedAt: now - 60000,
    startedAtText: 'start',
    currentStaffIds: ['E1'],
    staffSegments: [{ startAt: now - 60000, startAtText: 'start', endAt: null, endAtText: '', staffIds: ['E1'] }]
  };
  const employees = { E1: { id: 'E1', name: 'Alice', active: true } };
  const settlements = [];
  const orders = {
    O1: {
      id: 'O1',
      sessionId: 'S1',
      tableId: 'T01',
      tableName: 'Table 1',
      items: [{ productId: 'p001', name: 'Beer', price: 38, quantity: 1, commission: { version: 2, scope: 'shared', rateBps: 2000, amountCents: 760 } }],
      totalAmount: 38,
      createdAt: now - 1000
    }
  };
  const collection = (name) => ({
    where(filter) { this.filter = filter; return this; },
    orderBy() { return this; },
    skip() { return this; },
    limit() { return this; },
    async get() {
      if (name === 'bar_sessions') return { data: session ? [{ ...session }] : [] };
      if (name === 'bar_orders') return { data: Object.values(orders).filter((entry) => !this.filter || entry.sessionId === this.filter.sessionId) };
      return { data: [] };
    },
    doc(id) {
      return {
        async get() {
          if (name === 'bar_employees') return { data: employees[id] ? { ...employees[id] } : null };
          return { data: null };
        },
        async set({ data }) {
          if (name === 'bar_settlements') settlements.push(data);
        },
        async remove() {
          if (name === 'bar_sessions') session = null;
        }
      };
    }
  });
  const db = { runTransaction: async (callback) => callback({ collection }), collection };
  const cloud = {
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: 'admin' }),
    DYNAMIC_CURRENT_ENV: 'test'
  };
  const context = {
    exports: {},
    require: (id) => {
      if (id === 'wx-server-sdk') return cloud;
      if (id === './order-notifications') return { notifyWecomRobot: async () => ({ success: true }) };
      return require(id.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'barApi', id) : id);
    },
    process: { env: { ADMIN_OPENIDS: 'admin' } }
  };
  const file = path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return {
    main: context.exports.main,
    settlements,
    getSession: () => session,
    clearStaff() { session.currentStaffIds = []; session.staffSegments = [{ startAt: now - 60000, endAt: null, staffIds: [] }]; }
  };
}

test('server settles only the displayed session and amount', async () => {
  const api = loadApi();
  const preview = await api.main({ action: 'getTableDetail', tableId: 'T01' });
  const result = await api.main({
    action: 'settleTable',
    tableId: 'T01',
    expected: {
      sessionId: preview.data.id,
      totalAmount: preview.data.totalAmount,
      commissionAmountCents: preview.data.commission.amountCents
    }
  });
  assert.equal(result.data.totalAmount, preview.data.totalAmount);
  assert.equal(api.getSession(), null);
  assert.equal(api.settlements.length, 1);
});

test('changed bill or session is rejected without clearing', async () => {
  const api = loadApi();
  const preview = await api.main({ action: 'getTableDetail', tableId: 'T01' });
  for (const expected of [
    { sessionId: preview.data.id, totalAmount: 1, commissionAmountCents: preview.data.commission.amountCents },
    { sessionId: 'old-session', totalAmount: preview.data.totalAmount, commissionAmountCents: preview.data.commission.amountCents }
  ]) {
    const fresh = loadApi();
    await assert.rejects(fresh.main({ action: 'settleTable', tableId: 'T01', expected }));
    assert.ok(fresh.getSession());
    assert.equal(fresh.settlements.length, 0);
  }
});

test('settlement is blocked when no active staff can receive shared commission', async () => {
  const api = loadApi();
  api.clearStaff();
  const preview = await api.main({ action: 'getTableDetail', tableId: 'T01' });
  await assert.rejects(api.main({
    action: 'settleTable',
    tableId: 'T01',
    expected: {
      sessionId: preview.data.id,
      totalAmount: preview.data.totalAmount,
      commissionAmountCents: preview.data.commission.amountCents
    }
  }), /暂不能完成提成结算/);
  assert.ok(api.getSession());
  assert.equal(api.settlements.length, 0);
});
