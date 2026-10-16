const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../utils/commission');
const { products } = require('../config/mockData');
const { commissionView } = require('../utils/commission-display');

const apiDirectory = path.join(__dirname, '..', 'cloudfunctions', 'barApi');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('cloud and mini program use identical portable commission rules', () => {
  assert.equal(
    fs.readFileSync(path.join(apiDirectory, 'commission.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'utils', 'commission.js'), 'utf8')
  );
});

test('product commission supports shared designated and future rates', () => {
  assert.deepEqual(rules.itemCommission(products[0], 2), {
    version: 2,
    scope: 'shared',
    rateBps: 2000,
    amountCents: 1000
  });
  assert.deepEqual(rules.itemCommission(products.find((entry) => entry.id === 'p019'), 1, 'A'), {
    version: 2,
    scope: 'designated',
    rateBps: 3000,
    amountCents: 15000,
    designatedStaffId: 'A'
  });
  assert.equal(rules.itemCommission({ price: 500, commission: { scope: 'designated', rateBps: 5000 } }, 1, 'A').amountCents, 25000);
});

test('dynamic service segments shared goods and designated goods are split correctly', () => {
  const startedAt = Date.now() - (2 * 60 * 60 * 1000);
  const session = {
    id: 'S1',
    tableId: 'T01',
    tableName: '1号桌',
    startedAt,
    currentStaffIds: ['A', 'B'],
    staffSegments: [
      { startAt: startedAt, endAt: startedAt + (60 * 60 * 1000), staffIds: ['A'] },
      { startAt: startedAt + (60 * 60 * 1000), endAt: startedAt + (2 * 60 * 60 * 1000), staffIds: ['A', 'B'] }
    ]
  };
  const orders = [{
    id: 'O1',
    totalAmount: 550,
    items: [
      { productId: 'p001', name: '百威啤酒', price: 25, quantity: 2, commission: rules.itemCommission(products[0], 2) },
      { productId: 'p019', name: '香槟', price: 500, quantity: 1, commission: rules.itemCommission(products.find((entry) => entry.id === 'p019'), 1, 'B') }
    ]
  }];
  const summary = rules.summarizeSession(session, orders, startedAt + (2 * 60 * 60 * 1000), 99, {
    A: { id: 'A', name: 'Alice' },
    B: { id: 'B', name: 'Bob' }
  });
  assert.equal(summary.serviceFee, 297);
  assert.equal(summary.totalAmount, 847);
  assert.equal(summary.commission.serviceAmountCents, 5940);
  assert.equal(summary.commission.goodsSharedAmountCents, 1000);
  assert.equal(summary.commission.specialAmountCents, 15000);
  assert.equal(summary.commission.amountCents, 21940);
  assert.deepEqual(summary.commission.allocations.map((entry) => ({
    employeeId: entry.employeeId,
    serviceAmountCents: entry.serviceAmountCents,
    goodsSharedAmountCents: entry.goodsSharedAmountCents,
    specialAmountCents: entry.specialAmountCents,
    amountCents: entry.amountCents
  })), [
    { employeeId: 'A', serviceAmountCents: 3960, goodsSharedAmountCents: 500, specialAmountCents: 0, amountCents: 4460 },
    { employeeId: 'B', serviceAmountCents: 1980, goodsSharedAmountCents: 500, specialAmountCents: 15000, amountCents: 17480 }
  ]);
  const view = commissionView(summary.commission);
  assert.equal(view.amountText, '¥219.40');
  assert.equal(view.specialItems.length, 1);
  assert.equal(view.specialItems[0].name, '香槟');
  assert.equal(view.specialItems[0].employeeName, 'Bob');
  assert.equal(view.specialItems[0].rateText, '30%');
  assert.equal(view.specialItems[0].amountText, '¥150.00');
  assert.equal(view.allocations[1].specialItems.length, 1);
  assert.equal(view.allocations[1].specialItems[0].name, '香槟');
  assert.equal(view.allocations[1].specialItems[0].amountText, '¥150.00');
});

test('service fee keeps each game master on an independent continuous hourly clock', () => {
  const startedAt = Date.now() - (61 * 60 * 1000);
  const halfHour = 30 * 60 * 1000;
  const session = {
    id: 'S1',
    tableId: 'T01',
    tableName: '1号桌',
    startedAt,
    currentStaffIds: ['A', 'B'],
    staffSegments: [
      { startAt: startedAt, endAt: startedAt + halfHour, staffIds: ['A'] },
      { startAt: startedAt + halfHour, endAt: startedAt + (61 * 60 * 1000), staffIds: ['A', 'B'] }
    ]
  };
  const summary = rules.summarizeSession(session, [], startedAt + (61 * 60 * 1000), 99, {
    A: { id: 'A', name: 'Alice' },
    B: { id: 'B', name: 'Bob' }
  });
  assert.equal(summary.serviceFee, 297);
  assert.equal(summary.commission.serviceAmountCents, 5940);
  assert.equal(summary.commission.allocations.length, 2);
  assert.deepEqual(summary.commission.allocations.map((entry) => ({
    employeeId: entry.employeeId,
    serviceAmountCents: entry.serviceAmountCents
  })), [
    { employeeId: 'A', serviceAmountCents: 3960 },
    { employeeId: 'B', serviceAmountCents: 1980 }
  ]);
  assert.deepEqual(summary.commission.serviceSegments.map((entry) => ({
    employeeId: entry.employeeId,
    billedHours: entry.billedHours,
    serviceFee: entry.serviceFee
  })), [
    { employeeId: 'A', billedHours: 2, serviceFee: 198 },
    { employeeId: 'B', billedHours: 1, serviceFee: 99 }
  ]);
});

test('designated specials can split one multi-quantity line across multiple game masters', () => {
  const startedAt = Date.now() - (60 * 60 * 1000);
  const session = {
    id: 'S1',
    tableId: 'T01',
    tableName: '1号桌',
    startedAt,
    currentStaffIds: ['A', 'B'],
    staffSegments: [{ startAt: startedAt, endAt: startedAt + (60 * 60 * 1000), staffIds: ['A', 'B'] }]
  };
  const summary = rules.summarizeSession(session, [{
    id: 'O1',
    totalAmount: 2500,
    items: [{
      productId: 'p020',
      name: '轩尼诗VSOP',
      price: 500,
      quantity: 5,
      commission: {
        scope: 'designated',
        rateBps: 3000,
        amountCents: 75000,
        designatedAllocations: [{ staffId: 'A', quantity: 3 }, { staffId: 'B', quantity: 2 }]
      }
    }]
  }], startedAt + (60 * 60 * 1000), 99, {
    A: { id: 'A', name: 'Alice' },
    B: { id: 'B', name: 'Bob' }
  });
  assert.equal(summary.commission.specialItems.length, 2);
  assert.deepEqual(summary.commission.specialItems.map((entry) => ({
    designatedStaffId: entry.designatedStaffId,
    quantity: entry.quantity,
    amountCents: entry.amountCents
  })), [
    { designatedStaffId: 'A', quantity: 3, amountCents: 45000 },
    { designatedStaffId: 'B', quantity: 2, amountCents: 30000 }
  ]);
  assert.equal(summary.commission.unassignedItems.length, 0);
  assert.equal(summary.commission.allocations.find((entry) => entry.employeeId === 'A').specialAmountCents, 45000);
  assert.equal(summary.commission.allocations.find((entry) => entry.employeeId === 'B').specialAmountCents, 30000);
});

function loadApi(options = {}) {
  let documents = {
    bar_tables: {},
    bar_sessions: {},
    bar_orders: {},
    bar_settlements: {},
    bar_employees: {},
    bar_admin_members: {},
    bar_admin_invites: {}
  };
  let openid = 'admin';
  const qrRequests = [];
  const operations = [];
  const getField = (document, field) => field.split('.').reduce((value, key) => value && value[key], document);
  const collection = (name, transaction = false) => {
    let filter = null;
    const sort = [];
    let offset = 0;
    let limit = 100;
    const query = {
      where(value) { filter = value; return this; },
      orderBy(field, direction) { sort.push([field, direction]); return this; },
      skip(value) { offset = value; return this; },
      limit(value) { limit = value; return this; },
      async get() {
        operations.push({ name, type: 'query', transaction });
        const rows = Object.values(documents[name]).filter((doc) => !filter || Object.entries(filter).every(([key, value]) => getField(doc, key) === value));
        rows.sort((a, b) => {
          for (const [field, direction] of sort) {
            if (a[field] !== b[field]) return (a[field] < b[field] ? -1 : 1) * (direction === 'asc' ? 1 : -1);
          }
          return 0;
        });
        return { data: plain(rows.slice(offset, offset + limit)) };
      },
      async count() {
        const rows = Object.values(documents[name]).filter((doc) => !filter || Object.entries(filter).every(([key, value]) => getField(doc, key) === value));
        return { total: rows.length };
      },
      doc(id) {
        return {
          async get() {
            operations.push({ name, id, type: 'get', transaction });
            return { data: documents[name][id] ? plain(documents[name][id]) : null };
          },
          async set({ data }) {
            operations.push({ name, id, type: 'set', transaction });
            documents[name][id] = plain(data);
          },
          async update({ data }) {
            operations.push({ name, id, type: 'update', transaction });
            Object.assign(documents[name][id], plain(data));
          },
          async remove() {
            operations.push({ name, id, type: 'remove', transaction });
            delete documents[name][id];
          }
        };
      }
    };
    return query;
  };
  const db = {
    command: { gte: (value) => ({ $gte: value }) },
    collection,
    async runTransaction(callback) {
      const before = plain(documents);
      try { return await callback({ collection: (name) => collection(name, true) }); }
      catch (error) { documents = before; throw error; }
    }
  };
  const cloud = {
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid }),
    DYNAMIC_CURRENT_ENV: 'test',
    openapi: {
      wxacode: {
        getUnlimited: async (request) => {
          qrRequests.push(request);
          const failingVersions = Array.isArray(options.failWxacodeVersions) ? options.failWxacodeVersions : [];
          if (options.failWxacode || failingVersions.includes(request.envVersion)) throw new Error('wxacode unavailable');
          return { buffer: Buffer.from('invite') };
        }
      }
    },
    uploadFile: async ({ cloudPath }) => {
      if (options.failUpload) throw new Error('upload failed');
      return { fileID: `cloud://${cloudPath}` };
    },
    getTempFileURL: async ({ fileList }) => ({
      fileList: [{
        status: options.failTempUrl ? -1 : 0,
        tempFileURL: options.failTempUrl ? '' : `https://example.invalid/${fileList[0]}`,
        errMsg: options.failTempUrl ? 'temp url unavailable' : 'ok'
      }]
    })
  };
  const context = {
    exports: {},
    process: { env: { OWNER_OPENID: 'admin', ADMIN_OPENIDS: 'admin' } },
    console: { error() {} },
    Buffer,
    require: (id) => {
      if (id === 'wx-server-sdk') return cloud;
      if (id === './order-notifications') return { notifyWecomRobot: async () => ({ success: true }) };
      return require(id.startsWith('.') ? path.join(apiDirectory, id) : id);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(apiDirectory, 'index.js'), 'utf8'), context);
  return {
    call: async (action, data = {}) => {
      const result = await context.exports.main({ action, ...data });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    qrRequests: () => qrRequests.slice(),
    operations,
    documents: () => documents,
    setUser: (value) => { openid = value; }
  };
}

test('cloud flow assigns special items after ordering and snapshots settlement allocations', async () => {
  const api = loadApi();
  const alice = await api.call('saveEmployee', { employee: { name: 'Alice', active: true } });
  const bob = await api.call('saveEmployee', { employee: { name: 'Bob', active: true } });
  await api.call('updateTableStaff', { tableId: 'T01', staffIds: [alice.id, bob.id] });
  const order = await api.call('submitOrder', {
    tableId: 'T01',
    source: 'admin',
    items: [{ productId: 'p019', quantity: 1, designatedStaffId: bob.id }, { productId: 'p001', quantity: 2 }]
  });
  await api.call('assignSpecialItem', {
    tableId: 'T01', sessionId: order.sessionId, orderId: order.id, itemIndex: 0, staffId: bob.id
  });
  const summary = await api.call('getTableDetail', { tableId: 'T01' });
  assert.equal(summary.currentStaff.length, 2);
  assert.equal(summary.orders[0].items[0].commission.designatedStaffName, 'Bob');
  assert.equal(summary.commission.status, 'complete');
  assert.ok(summary.commission.amountCents > 0);

  const settlement = await api.call('settleTable', {
    tableId: 'T01',
    expected: {
      sessionId: summary.id,
      totalAmount: summary.totalAmount,
      commissionAmountCents: summary.commission.amountCents
    }
  });
  assert.equal(settlement.commission.payoutStatus, 'pending');
  assert.deepEqual(settlement.commission.allocations.map((entry) => entry.employeeName).sort(), ['Alice', 'Bob']);
  assert.equal(api.documents().bar_sessions.T01, undefined);
  const paid = await api.call('markCommissionPaid', { settlementId: settlement.id });
  assert.equal(paid.commission.payoutStatus, 'paid');
});

test('cloud dashboard table totals include ordered goods as well as service fees', async () => {
  const api = loadApi();
  const alice = await api.call('saveEmployee', { employee: { name: 'Alice', active: true } });
  await api.call('updateTableStaff', { tableId: 'T01', staffIds: [alice.id] });
  await api.call('submitOrder', {
    tableId: 'T01',
    source: 'admin',
    items: [{ productId: 'p001', quantity: 2 }]
  });

  const dashboard = await api.call('getDashboard');
  const table = dashboard.tables.find((entry) => entry.id === 'T01');

  assert.equal(table.itemTotal, 50);
  assert.equal(table.serviceFee, 99);
  assert.equal(table.totalAmount, 149);
});

test('special goods are auto-assigned to the sole current staff and do not block admin orders without staff', async () => {
  const api = loadApi();
  const alice = await api.call('saveEmployee', { employee: { name: 'Alice', active: true } });
  await api.call('updateTableStaff', { tableId: 'T01', staffIds: [alice.id] });
  const customerOrder = await api.call('submitOrder', { tableId: 'T01', items: [{ productId: 'p019', quantity: 1 }] });
  assert.equal(customerOrder.items[0].commission, undefined);
  const summary = await api.call('getTableDetail', { tableId: 'T01' });
  assert.equal(summary.orders[0].items[0].commission.designatedStaffName, 'Alice');

  await api.call('updateTableStaff', { tableId: 'T01', staffIds: [alice.id] });
  const unassignedOrder = await api.call('submitOrder', {
    tableId: 'T02',
    source: 'admin',
    items: [{ productId: 'p019', quantity: 1 }]
  });
  assert.equal(api.documents().bar_orders[unassignedOrder.id].items[0].commission.designatedStaffId, undefined);
});

test('owner can invite and remove backend members while members cannot manage peers', async () => {
  const api = loadApi();
  const invite = await api.call('createAdminInvite');
  assert.match(invite.code, /^[A-Z0-9]{8}$/);
  assert.ok(invite.qrCodeUrl);
  assert.ok(invite.qrCodeDataUrl);
  api.setUser('member-openid');
  const accepted = await api.call('acceptAdminInvite', { code: invite.code });
  assert.equal(accepted.joined, true);
  assert.equal(await api.call('isAdmin'), true);
  const profile = await api.call('getAdminProfile');
  assert.equal(profile.isOwner, false);
  const members = await api.call('listAdminMembers');
  assert.equal(members.length, 2);
  await assert.rejects(api.call('createAdminInvite'), /唯一管理员/);
  await assert.rejects(api.call('removeAdminMember', { openid: 'member-openid' }), /唯一管理员/);
  api.setUser('admin');
  await api.call('removeAdminMember', { openid: 'member-openid' });
  api.setUser('member-openid');
  await assert.rejects(api.call('getTableDetail', { tableId: 'T01' }), /未获管理员授权/);
});

test('invite generation falls back to inline qr image data when upload url is unavailable', async () => {
  const api = loadApi({ failTempUrl: true });
  const invite = await api.call('createAdminInvite');
  assert.equal(invite.qrCodeUrl, '');
  assert.match(invite.qrCodeDataUrl, /^data:image\/png;base64,/);
});

test('invite generation falls back from release to trial when release wxacode fails', async () => {
  const api = loadApi({ failWxacodeVersions: ['release'] });
  const invite = await api.call('createAdminInvite');
  assert.equal(invite.qrCodeEnvVersion, 'trial');
  assert.equal(api.qrRequests().map((entry) => entry.envVersion).join(','), 'release,trial');
  assert.equal(api.qrRequests()[0].checkPath, true);
  assert.equal(api.qrRequests()[1].checkPath, false);
});

test('invite generation fails when wxacode image cannot be generated', async () => {
  const api = loadApi({ failWxacode: true });
  await assert.rejects(api.call('createAdminInvite'), /release: .*trial: .*develop:/);
});

function loadLocalStore(mode = 'local') {
  const storage = new Map();
  const cloudCalls = [];
  const filename = path.join(__dirname, '..', 'services', 'store.js');
  const context = {
    module: { exports: {} },
    wx: {
      getStorageSync: (key) => storage.has(key) ? structuredClone(storage.get(key)) : '',
      setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
      cloud: {
        callFunction: async (request) => {
          cloudCalls.push(request);
          return { result: { success: true, data: { id: 'saved-order' } } };
        }
      }
    },
    require: (id) => id === '../config/app' ? { ...require('../config/app'), storageMode: mode, cloudEnvId: 'test' }
      : require(path.resolve(path.dirname(filename), id))
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return { store: context.module.exports, storage, cloudCalls };
}

test('local mode keeps the same staffing and settlement rules', async () => {
  const { store } = loadLocalStore();
  const employee = await store.saveEmployee({ name: 'Alice', active: true });
  await store.saveTableStaff('T01', [employee.id]);
  await store.submitOrder({ tableId: 'T01', source: 'admin', items: [{ productId: 'p019', quantity: 1, designatedStaffId: employee.id }] });
  const bill = await store.getTableDetail('T01');
  assert.equal(bill.currentStaff[0].name, 'Alice');
  assert.equal(bill.commission.status, 'complete');
  const settlement = await store.settleTable('T01', {
    sessionId: bill.id,
    totalAmount: bill.totalAmount,
    commissionAmountCents: bill.commission.amountCents
  });
  assert.equal(settlement.commission.allocations[0].employeeName, 'Alice');
});

test('store forwards special item assignment to cloud with a normalized table id', async () => {
  const { store, cloudCalls } = loadLocalStore('cloud');
  const result = await store.assignSpecialItem({
    tableId: '1', sessionId: 'S1', orderId: 'O1', itemIndex: 0, staffId: 'E1'
  });
  assert.equal(result.id, 'saved-order');
  assert.deepEqual(plain(cloudCalls[0].data), {
    action: 'assignSpecialItem', tableId: 'T01', sessionId: 'S1', orderId: 'O1', itemIndex: 0, staffId: 'E1'
  });
});

for (const mode of ['cloud', 'local']) {
  test(`${mode} prevents a game master from being bound to multiple active tables`, async () => {
    const api = mode === 'cloud' ? loadApi() : null;
    const local = mode === 'local' ? loadLocalStore() : null;
    const store = local && local.store;
    const saveEmployee = (name) => api
      ? api.call('saveEmployee', { employee: { name, active: true } })
      : store.saveEmployee({ name, active: true });
    const bindTable = (tableId, staffIds) => api
      ? api.call('updateTableStaff', { tableId, staffIds })
      : store.saveTableStaff(tableId, staffIds);
    const alice = await saveEmployee('Alice');
    const bob = await saveEmployee('Bob');

    await bindTable('T01', [alice.id]);
    await assert.rejects(bindTable('T02', [alice.id, bob.id]), /Alice 已在 .*不能同时绑定到多张桌台/);
    await bindTable('T01', [alice.id, bob.id]);
  });
}

for (const mode of ['cloud', 'local']) {
  test(`${mode} customer special orders ignore attribution input with zero multiple and sole current staff`, async () => {
    const api = mode === 'cloud' ? loadApi() : null;
    const local = mode === 'local' ? loadLocalStore() : null;
    const submit = (tableId, items) => api
      ? api.call('submitOrder', { tableId, items })
      : local.store.submitOrder({ tableId, items });
    const staff = (ids) => api
      ? api.call('updateTableStaff', { tableId: 'T01', staffIds: ids })
      : local.store.saveTableStaff('T01', ids);
    const employee = (name) => api
      ? api.call('saveEmployee', { employee: { name, active: true } })
      : local.store.saveEmployee({ name, active: true });
    const detail = () => api ? api.call('getTableDetail', { tableId: 'T01' }) : local.store.getTableDetail('T01');
    const alice = await employee('Alice');
    const bob = await employee('Bob');
    const orderAsCustomer = async (staffId) => {
      if (api) api.setUser('customer');
      const order = await submit('T01', [
        { productId: 'p019', quantity: 1, designatedStaffId: staffId },
        { productId: 'p001', quantity: 1, designatedStaffId: staffId }
      ]);
      assert.equal(order.items[0].commission, undefined);
      assert.equal(order.items[1].commission, undefined);
      if (api) api.setUser('admin');
      const bill = await detail();
      const saved = bill.orders.find((entry) => entry.id === order.id);
      assert.equal(saved.items[1].commission.designatedStaffId, undefined);
      return saved;
    };
    assert.equal((await orderAsCustomer('not-a-current-employee')).items[0].commission.designatedStaffId, undefined);
    await staff([alice.id, bob.id]);
    assert.equal((await orderAsCustomer(bob.id)).items[0].commission.designatedStaffId, undefined);
    await staff([alice.id]);
    assert.equal((await orderAsCustomer(bob.id)).items[0].commission.designatedStaffId, alice.id);
  });

  test(`${mode} assignment validates scope and ownership preserves snapshots and allows eventual settlement`, async () => {
    const api = mode === 'cloud' ? loadApi() : null;
    const local = mode === 'local' ? loadLocalStore() : null;
    const store = local && local.store;
    const employee = (name, active = true) => api
      ? api.call('saveEmployee', { employee: { name, active } }) : store.saveEmployee({ name, active });
    const detail = () => api ? api.call('getTableDetail', { tableId: 'T01' }) : store.getTableDetail('T01');
    const submit = (tableId, items) => api ? api.call('submitOrder', { tableId, items }) : store.submitOrder({ tableId, items });
    const assign = (event) => api ? api.call('assignSpecialItem', event) : store.assignSpecialItem(event);
    const settle = (bill) => {
      const expected = { sessionId: bill.id, totalAmount: bill.totalAmount, commissionAmountCents: bill.commission.amountCents };
      return api ? api.call('settleTable', { tableId: 'T01', expected }) : store.settleTable('T01', expected);
    };
    const alice = await employee('Alice');
    const bob = await employee('Bob');
    const outsider = await employee('Outsider');
    const inactive = await employee('Inactive', false);
    if (api) {
      await api.call('updateTableStaff', { tableId: 'T01', staffIds: [alice.id, bob.id] });
    } else {
      await store.saveTableStaff('T01', [alice.id, bob.id]);
    }
    const order = await submit('T01', [{ productId: 'p019', quantity: 2 }, { productId: 'p001', quantity: 1 }]);
    const otherOrder = await submit('T02', [{ productId: 'p019', quantity: 1 }]);
    const event = { tableId: 'T01', sessionId: order.sessionId, orderId: order.id, itemIndex: 0, staffId: alice.id };
    const initial = await detail();
    assert.equal(initial.commission.status, 'pending_special_assignment');
    await assert.rejects(settle(initial), /未指定归属/);
    if (api) {
      api.setUser('customer');
      await assert.rejects(assign(event), /未获管理员授权/);
      api.setUser('admin');
    }
    for (const change of [
      { tableId: 'T99' }, { sessionId: '' }, { sessionId: 'stale-session' },
      { tableId: 'T02' }, { orderId: '' }, { orderId: 'missing-order' }, { orderId: otherOrder.id },
      { itemIndex: -1 }, { itemIndex: 0.5 }, { itemIndex: '0' }, { itemIndex: Number.MAX_SAFE_INTEGER + 1 },
      { itemIndex: 99 }, { itemIndex: 1 }, { staffId: '' }, { staffId: 'missing-staff' },
      { staffId: outsider.id }, { staffId: inactive.id }
    ]) {
      await assert.rejects(assign({ ...event, ...change }));
    }
    // Also reject a current employee whose employment was disabled after binding.
    if (api) {
      api.documents().bar_employees[bob.id].active = false;
    } else {
      const employees = local.storage.get('bar_employees');
      employees.find((entry) => entry.id === bob.id).active = false;
    }
    await assert.rejects(assign({ ...event, staffId: bob.id }), /在职/);
    if (api) {
      api.documents().bar_employees[bob.id].active = true;
    } else {
      local.storage.get('bar_employees').find((entry) => entry.id === bob.id).active = true;
    }
    // A historic rate different from today's catalog must survive assignment.
    const savedOrder = api ? api.documents().bar_orders[order.id] : local.storage.get('bar_orders').find((entry) => entry.id === order.id);
    savedOrder.items[0].commission.rateBps = 1750;
    savedOrder.items[0].commission.amountCents = 17500;
    const before = plain(savedOrder);
    if (api) api.operations.length = 0;
    const assigned = await assign({ ...event, tableId: '1', staffId: ` ${alice.id} ` });
    assert.deepEqual(plain(assigned), {
      ...before,
      items: before.items.map((item, index) => index === 0
        ? {
          ...item,
          commission: {
            ...item.commission,
            designatedStaffId: alice.id,
            designatedAllocations: [{ staffId: alice.id, quantity: 2 }]
          }
        }
        : item)
    });
    if (api) {
      for (const [name, id, type] of [
        ['bar_sessions', 'T01', 'get'], ['bar_sessions', 'T01', 'set'],
        ['bar_orders', order.id, 'get'], ['bar_orders', order.id, 'update']
      ]) {
        assert.ok(api.operations.some((operation) =>
          operation.name === name && operation.id === id && operation.type === type && operation.transaction));
      }
    }
    const reassigned = await assign({ ...event, staffId: bob.id });
    assert.deepEqual(plain(reassigned.items[0].commission), {
      ...before.items[0].commission,
      designatedStaffId: bob.id,
      designatedAllocations: [{ staffId: bob.id, quantity: 2 }]
    });
    assert.equal(reassigned.totalAmount, before.totalAmount);
    const bill = await detail();
    assert.equal(bill.commission.status, 'complete');
    assert.equal(bill.commission.allocations.find((entry) => entry.employeeId === bob.id).specialAmountCents, 17500);
    const split = await assign({
      ...event,
      assignments: [{ staffId: alice.id, quantity: 1 }, { staffId: bob.id, quantity: 1 }]
    });
    assert.deepEqual(plain(split.items[0].commission), {
      ...before.items[0].commission,
      designatedStaffId: '',
      designatedAllocations: [{ staffId: alice.id, quantity: 1 }, { staffId: bob.id, quantity: 1 }]
    });
    const splitBill = await detail();
    assert.equal(splitBill.commission.specialItems.length, 2);
    assert.equal(splitBill.commission.specialItems[0].quantity, 1);
    assert.equal(splitBill.commission.specialItems[1].quantity, 1);
    if (api) api.operations.length = 0;
    const settlement = await settle(splitBill);
    assert.equal(settlement.commission.specialAmountCents, 17500);
    if (api) {
      assert.ok(api.operations.some((operation) =>
        operation.name === 'bar_orders' && operation.type === 'query' && operation.transaction));
      assert.ok(api.operations.some((operation) =>
        operation.name === 'bar_sessions' && operation.id === 'T01' && operation.type === 'remove' && operation.transaction));
    }
    await assert.rejects(assign(event), /已买单/);
    await submit('T01', [{ productId: 'p001', quantity: 1 }]);
    await assert.rejects(assign(event), /场次已变化/);
  });
}
