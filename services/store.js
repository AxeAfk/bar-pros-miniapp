const { tables, menuCategories, products } = require('../config/mockData');
const { hourlyServiceFee, cloudEnvId, storageMode } = require('../config/app');
const { createId, formatTime, formatDuration } = require('../utils/format');
const { normalizeTableId } = require('../utils/entry');

const KEYS = {
  tables: 'bar_tables',
  orders: 'bar_orders',
  members: 'bar_members',
  sessions: 'bar_active_sessions',
  settlements: 'bar_settlements'
};

function read(key, fallback) {
  const value = wx.getStorageSync(key);
  return value || fallback;
}

function write(key, value) {
  wx.setStorageSync(key, value);
  return value;
}

function getOrders() {
  return read(KEYS.orders, []);
}

function getOrder(orderId) {
  return getOrders().find((order) => order.id === orderId);
}

function getActiveSessions() {
  return read(KEYS.sessions, {});
}

function getActiveSession(tableId) {
  return getActiveSessions()[normalizeTableId(tableId)];
}

function getSessionOrders(sessionId) {
  return getOrders()
    .filter((order) => order.sessionId === sessionId)
    .sort((first, second) => first.createdAt - second.createdAt);
}

function getSessionSummary(session) {
  if (!session) {
    return null;
  }

  const elapsedMs = Math.max(0, Date.now() - session.startedAt);
  const billableHours = Math.max(1, Math.ceil(elapsedMs / (60 * 60 * 1000)));
  const orders = getSessionOrders(session.id);
  const itemTotal = orders.reduce((sum, order) => sum + order.totalAmount, 0);
  const serviceFee = billableHours * hourlyServiceFee;
  return {
    ...session,
    orders,
    elapsedMs,
    elapsedText: formatDuration(elapsedMs),
    billableHours,
    serviceFee,
    itemTotal,
    totalAmount: itemTotal + serviceFee
  };
}

function getTables() {
  const activeSessions = getActiveSessions();
  return read(KEYS.tables, tables).map((table) => {
    const session = activeSessions[normalizeTableId(table.id)];
    const summary = getSessionSummary(session);
    return {
      ...table,
      status: summary ? 'using' : 'idle',
      sessionId: summary ? summary.id : '',
      startedAt: summary ? summary.startedAt : null,
      elapsedText: summary ? summary.elapsedText : '',
      itemTotal: summary ? summary.itemTotal : 0,
      serviceFee: summary ? summary.serviceFee : 0,
      totalAmount: summary ? summary.totalAmount : 0
    };
  });
}

function getTableById(tableId) {
  const normalizedId = normalizeTableId(tableId);
  return getTables().find((table) => normalizeTableId(table.id) === normalizedId);
}

function getMenu() {
  return {
    categories: menuCategories,
    products: products.filter((product) => product.onSale)
  };
}

function createOrder({ tableId, tableName, items, payMethod, source }) {
  const normalizedTableId = normalizeTableId(tableId);
  const table = getTableById(normalizedTableId);
  if (!table) {
    throw new Error('桌号无效，无法提交订单');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('请先选择商品');
  }

  const validItems = items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId && candidate.onSale);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1) {
      throw new Error('订单商品信息无效，请重新选择');
    }
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity
    };
  });

  const now = Date.now();
  const activeSessions = getActiveSessions();
  let session = activeSessions[normalizedTableId];
  if (!session) {
    session = {
      id: createId('S'),
      tableId: normalizedTableId,
      tableName: tableName || table.name,
      startedAt: now,
      startedAtText: formatTime(now)
    };
    activeSessions[normalizedTableId] = session;
  }

  const order = {
    id: createId('O'),
    sessionId: session.id,
    tableId: normalizedTableId,
    tableName: tableName || table.name,
    items: validItems,
    totalAmount: validItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
    payMethod: payMethod || 'order',
    source: source || 'customer',
    status: 'submitted',
    createdAt: now,
    createdAtText: formatTime(now)
  };
  write(KEYS.sessions, activeSessions);
  write(KEYS.orders, [order, ...getOrders()]);
  return order;
}

function getTodayStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayOrders = getOrders().filter((order) => order.createdAt >= start.getTime());
  const completedTotal = read(KEYS.settlements, [])
    .filter((settlement) => settlement.closedAt >= start.getTime())
    .reduce((sum, settlement) => sum + settlement.totalAmount, 0);
  const activeTotal = Object.keys(getActiveSessions()).reduce((sum, tableId) => {
    const session = getSessionSummary(getActiveSession(tableId));
    return session ? sum + session.totalAmount : sum;
  }, 0);
  return {
    orderCount: todayOrders.length,
    revenue: completedTotal + activeTotal
  };
}

function closeTable(tableId, expected) {
  const normalizedTableId = normalizeTableId(tableId);
  const activeSessions = getActiveSessions();
  const session = activeSessions[normalizedTableId];
  if (!session) {
    throw new Error('该桌当前没有进行中的消费');
  }

  const summary = getSessionSummary(session);
  if (!expected || session.id !== expected.sessionId || summary.totalAmount !== expected.totalAmount) {
    throw new Error('账单已变化，请重新打开买单账单核对金额后再确认收款');
  }
  const settlement = {
    ...summary,
    orders: summary.orders.map((order) => order.id),
    closedAt: Date.now(),
    closedAtText: formatTime(Date.now())
  };
  delete activeSessions[normalizedTableId];
  write(KEYS.settlements, [settlement, ...read(KEYS.settlements, [])]);
  write(KEYS.sessions, activeSessions);
  return settlement;
}

function getSettlements() {
  return read(KEYS.settlements, []);
}

function callCloud(action, data) {
  if (!cloudEnvId) {
    return Promise.reject(new Error('请先在 config/app.js 配置微信云开发环境 ID'));
  }
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('当前小程序未启用微信云开发能力'));
  }

  return wx.cloud.callFunction({
    name: 'barApi',
    data: { action, ...(data || {}) }
  }).then((response) => {
    if (!response || !response.result || response.result.success !== true) {
      throw new Error(response && response.result && response.result.error
        ? response.result.error
        : '云端请求失败');
    }
    return response.result.data;
  });
}

function listTables() {
  return storageMode === 'cloud'
    ? callCloud('listTables')
    : Promise.resolve(getTables());
}

function isAdmin() {
  return storageMode === 'cloud'
    ? callCloud('isAdmin')
    : Promise.resolve(false);
}

function getCustomerSession(tableId, sessionId) {
  if (storageMode === 'cloud') {
    return callCloud('getCustomerSession', {
      tableId: normalizeTableId(tableId),
      sessionId
    });
  }
  if (sessionId) {
    const session = getActiveSession(tableId);
    return Promise.resolve(session && session.id === sessionId ? getSessionSummary(session) : null);
  }
  return Promise.resolve(getSessionSummary(getActiveSession(tableId)));
}

function getOrderAsync(orderId) {
  return storageMode === 'cloud'
    ? callCloud('getOrder', { orderId })
    : Promise.resolve(getOrder(orderId));
}

function getDashboard() {
  if (storageMode === 'cloud') {
    return callCloud('getDashboard');
  }
  return Promise.resolve({
    stats: getTodayStats(),
    tables: getTables(),
    orders: getOrders().slice(0, 10),
    settlements: getSettlements().slice(0, 10)
  });
}

function getTableDetail(tableId) {
  if (storageMode === 'cloud') {
    return callCloud('getTableDetail', { tableId: normalizeTableId(tableId) });
  }
  return Promise.resolve(getSessionSummary(getActiveSession(tableId)));
}

function submitOrder(order) {
  if (storageMode === 'cloud') {
    return callCloud('submitOrder', {
      tableId: normalizeTableId(order.tableId),
      items: order.items,
      source: order.source || 'customer'
    });
  }
  return Promise.resolve(createOrder(order));
}

function settleTable(tableId, expected) {
  return storageMode === 'cloud'
    ? callCloud('settleTable', { tableId: normalizeTableId(tableId), expected })
    : Promise.resolve().then(() => closeTable(tableId, expected));
}

function getMembers() {
  return read(KEYS.members, [
    {
      id: 'M001',
      name: '模拟会员',
      phone: '13800000000',
      balance: 5200,
      createdAtText: formatTime(Date.now())
    }
  ]);
}

function rechargeMember({ memberId, amount, gift }) {
  const members = getMembers().map((member) => {
    if (member.id !== memberId) return member;
    return {
      ...member,
      balance: member.balance + amount + gift,
      lastRechargeText: formatTime(Date.now())
    };
  });
  write(KEYS.members, members);
  return members.find((member) => member.id === memberId);
}

module.exports = {
  getTables,
  getTableById,
  getMenu,
  getOrders,
  getOrder,
  getActiveSession,
  getSessionSummary,
  getSessionOrders,
  createOrder,
  closeTable,
  getSettlements,
  getTodayStats,
  listTables,
  isAdmin,
  getCustomerSession,
  getOrderAsync,
  getDashboard,
  getTableDetail,
  submitOrder,
  settleTable,
  getMembers,
  rechargeMember
};
