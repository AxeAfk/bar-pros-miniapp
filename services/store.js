const { tables, menuCategories, products } = require('../config/mockData');
const { hourlyServiceFee, cloudEnvId, storageMode } = require('../config/app');
const { createId, formatTime, formatDuration } = require('../utils/format');
const { normalizeTableId } = require('../utils/entry');
const commissionRules = require('../utils/commission');

const KEYS = {
  tables: 'bar_tables',
  orders: 'bar_orders',
  members: 'bar_members',
  sessions: 'bar_active_sessions',
  settlements: 'bar_settlements',
  employees: 'bar_employees',
  adminMembers: 'bar_admin_members',
  adminInvites: 'bar_admin_invites'
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

function getEmployeeDirectory() {
  return Object.fromEntries(read(KEYS.employees, []).map((employee) => [employee.id, employee]));
}

function createStaffSegment(staffIds, startedAt) {
  return {
    startAt: startedAt,
    startAtText: formatTime(startedAt),
    endAt: null,
    endAtText: '',
    staffIds: commissionRules.normalizeStaffIds(staffIds)
  };
}

function createSessionRecord(table, startedAt, staffIds = []) {
  const normalizedStaffIds = commissionRules.normalizeStaffIds(staffIds);
  return {
    id: createId('S'),
    tableId: normalizeTableId(table.id),
    tableName: table.name,
    startedAt,
    startedAtText: formatTime(startedAt),
    currentStaffIds: normalizedStaffIds,
    staffSegments: [createStaffSegment(normalizedStaffIds, startedAt)]
  };
}

function getSessionSummary(session) {
  if (!session) {
    return null;
  }
  const orders = getSessionOrders(session.id);
  const summary = commissionRules.summarizeSession(
    session,
    orders,
    Date.now(),
    hourlyServiceFee,
    getEmployeeDirectory()
  );
  const employeesById = getEmployeeDirectory();
  const decoratedOrders = orders.map((order) => ({
    ...order,
    items: order.items.map((item) => item.commission && item.commission.designatedStaffId
      ? {
        ...item,
        commission: {
          ...item.commission,
          designatedStaffName: employeesById[item.commission.designatedStaffId]
            ? employeesById[item.commission.designatedStaffId].name
            : item.commission.designatedStaffId
        }
      }
      : item)
  }));
  return {
    ...session,
    ...summary,
    currentStaff: (session.currentStaffIds || []).map((employeeId) => ({
      id: employeeId,
      name: employeesById[employeeId] ? employeesById[employeeId].name : employeeId
    })),
    orders: decoratedOrders,
    elapsedText: formatDuration(summary.elapsedMs)
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

  const activeSessions = getActiveSessions();
  let session = activeSessions[normalizedTableId];
  if (!session) {
    session = createSessionRecord(table, Date.now(), []);
    activeSessions[normalizedTableId] = session;
  }
  const activeStaffIds = Array.isArray(session.currentStaffIds) ? session.currentStaffIds : [];

  const validItems = items.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId && candidate.onSale);
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error('订单商品信息无效，请重新选择');
    }
    const config = commissionRules.normalizeProductCommission(product);
    const designatedStaffId = config.scope === 'designated' && activeStaffIds.length === 1
      ? activeStaffIds[0] : '';
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity,
      commission: commissionRules.itemCommission(product, quantity, designatedStaffId)
    };
  });

  const now = Date.now();
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

function getLocalAdminMembers() {
  return read(KEYS.adminMembers, []);
}

function getLocalAdminInvites() {
  return read(KEYS.adminInvites, []);
}

function updateTableStaff(tableId, staffIds) {
  const normalizedTableId = normalizeTableId(tableId);
  const table = getTableById(normalizedTableId);
  if (!table) {
    throw new Error('桌号无效');
  }
  const normalizedStaffIds = commissionRules.normalizeStaffIds(staffIds);
  if (!normalizedStaffIds.length) {
    throw new Error('请至少绑定一位在台游戏师');
  }
  const employees = read(KEYS.employees, []);
  const directory = Object.fromEntries(employees.map((employee) => [employee.id, employee]));
  normalizedStaffIds.forEach((employeeId) => {
    if (!directory[employeeId] || !directory[employeeId].active) {
      throw new Error('请选择有效且在职的游戏师');
    }
  });

  const activeSessions = getActiveSessions();
  const now = Date.now();
  const existing = activeSessions[normalizedTableId];
  const session = existing || createSessionRecord(table, now, normalizedStaffIds);
  if (existing) {
    const current = commissionRules.normalizeStaffIds(Array.isArray(session.currentStaffIds) ? session.currentStaffIds : []);
    if (current.length === normalizedStaffIds.length && current.every((id, index) => id === normalizedStaffIds[index])) {
      return session;
    }
    const segments = Array.isArray(session.staffSegments) && session.staffSegments.length
      ? session.staffSegments.map((segment) => ({ ...segment, staffIds: commissionRules.normalizeStaffIds(segment.staffIds || []) }))
      : [createStaffSegment(current, session.startedAt)];
    const last = segments[segments.length - 1];
    if (last.endAt === null || last.endAt === undefined) {
      last.endAt = now;
      last.endAtText = formatTime(now);
    }
    segments.push(createStaffSegment(normalizedStaffIds, now));
    session.currentStaffIds = normalizedStaffIds;
    session.staffSegments = segments;
  }
  activeSessions[normalizedTableId] = session;
  write(KEYS.sessions, activeSessions);
  return session;
}

function closeTable(tableId, expected) {
  const normalizedTableId = normalizeTableId(tableId);
  const activeSessions = getActiveSessions();
  const session = activeSessions[normalizedTableId];
  if (!session) {
    throw new Error('该桌当前没有进行中的消费');
  }

  const summary = getSessionSummary(session);
  if (!expected || session.id !== expected.sessionId ||
      commissionRules.cents(summary.totalAmount) !== commissionRules.cents(expected.totalAmount)) {
    throw new Error('账单已变化，请重新打开买单账单核对金额后再确认收款');
  }
  if (expected.commissionAmountCents !== summary.commission.amountCents) {
    throw new Error('提成金额已变化，请重新打开买单账单核对');
  }
  const settlement = {
    ...summary,
    id: createId('C'),
    sessionId: session.id,
    commission: commissionRules.settleCommission(summary.commission, read(KEYS.employees, [])),
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

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `[unserializable: ${error && error.message ? error.message : 'unknown error'}]`;
  }
}

function logCloudError(stage, action, data, details) {
  if (typeof console !== 'undefined' && console && typeof console.error === 'function') {
    const payload = {
      action,
      requestData: data || {},
      details
    };
    const summary = details && details.result && details.result.error
      ? details.result.error
      : details && details.message
        ? details.message
        : details && details.errMsg
          ? details.errMsg
          : '';
    console.error(`[barApi:${action}] ${stage}${summary ? `: ${summary}` : ''}`);
    console.error(`[barApi:${action}] payload\n${safeJson(payload)}`);
  }
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
      const message = response && response.result && response.result.error
        ? response.result.error
        : '云端请求失败';
      logCloudError('business failure', action, data, response);
      const error = new Error(message);
      error._cloudLogged = true;
      throw error;
    }
    return response.result.data;
  }).catch((error) => {
    if (!error || !error._cloudLogged) {
      logCloudError('transport failure', action, data, {
        message: error && error.message,
        errMsg: error && error.errMsg,
        stack: error && error.stack
      });
    }
    throw error;
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

function getAdminProfile() {
  return storageMode === 'cloud'
    ? callCloud('getAdminProfile')
    : Promise.resolve({ isAdmin: false, isOwner: false, ownerOpenid: '' });
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
    return Promise.resolve(session && session.id === sessionId ? customerSummary(getSessionSummary(session)) : null);
  }
  return Promise.resolve(customerSummary(getSessionSummary(getActiveSession(tableId))));
}

function customerOrder(order) {
  if (!order) return order;
  const { commission, ...visible } = order;
  return { ...visible, items: order.items.map(({ commission: itemCommission, ...item }) => item) };
}

function customerSummary(summary) {
  if (!summary) return summary;
  const { commission, ...visible } = summary;
  return { ...visible, orders: summary.orders.map(customerOrder) };
}

function getOrderAsync(orderId) {
  return storageMode === 'cloud'
    ? callCloud('getOrder', { orderId })
    : Promise.resolve(customerOrder(getOrder(orderId)));
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
  return Promise.resolve(customerOrder(createOrder(order)));
}

function settleTable(tableId, expected) {
  return storageMode === 'cloud'
    ? callCloud('settleTable', { tableId: normalizeTableId(tableId), expected })
    : Promise.resolve().then(() => closeTable(tableId, expected));
}

function assignSpecialItem({ tableId, sessionId, orderId, itemIndex, staffId }) {
  const normalizedTableId = normalizeTableId(tableId);
  if (storageMode === 'cloud') {
    return callCloud('assignSpecialItem', { tableId: normalizedTableId, sessionId, orderId, itemIndex, staffId });
  }
  return Promise.resolve().then(() => {
    if (!tables.some((table) => table.id === normalizedTableId)) throw new Error('桌号无效');
    if (typeof sessionId !== 'string' || !sessionId ||
        typeof orderId !== 'string' || !orderId ||
        !Number.isSafeInteger(itemIndex) || itemIndex < 0) {
      throw new Error('特殊商品归属参数无效');
    }
    const session = getActiveSession(normalizedTableId);
    if (!session || session.id !== sessionId || session.tableId !== normalizedTableId) {
      throw new Error('消费场次已变化或已买单，请刷新账单');
    }
    const orders = getOrders();
    const order = orders.find((entry) => entry.id === orderId);
    if (!order || order.tableId !== normalizedTableId || order.sessionId !== sessionId) {
      throw new Error('订单不属于当前桌台场次');
    }
    const item = Array.isArray(order.items) ? order.items[itemIndex] : null;
    if (!item || !item.commission || item.commission.scope !== 'designated') {
      throw new Error('请选择有效的特殊商品');
    }
    const normalizedStaffId = typeof staffId === 'string' ? staffId.trim() : '';
    const employee = getEmployeeDirectory()[normalizedStaffId];
    if (!(session.currentStaffIds || []).includes(normalizedStaffId) || !employee || !employee.active) {
      throw new Error('请选择当前在台且在职的游戏师');
    }
    const saved = {
      ...order,
      items: order.items.map((entry, index) => index === itemIndex
        ? { ...entry, commission: { ...entry.commission, designatedStaffId: normalizedStaffId } }
        : entry)
    };
    write(KEYS.orders, orders.map((entry) => entry.id === orderId ? saved : entry));
    return saved;
  });
}

function saveTableStaff(tableId, staffIds) {
  return storageMode === 'cloud'
    ? callCloud('updateTableStaff', { tableId: normalizeTableId(tableId), staffIds })
    : Promise.resolve().then(() => updateTableStaff(tableId, staffIds));
}

function listAdminMembers() {
  if (storageMode === 'cloud') return callCloud('listAdminMembers');
  return Promise.resolve(getLocalAdminMembers());
}

function createAdminInvite() {
  if (storageMode === 'cloud') return callCloud('createAdminInvite');
  return Promise.resolve().then(() => {
    const invite = {
      code: createId('I').slice(-8).toUpperCase(),
      expiresAt: Date.now() + 30 * 60 * 1000,
      expiresAtText: formatTime(Date.now() + 30 * 60 * 1000),
      qrCodeUrl: '',
      status: 'pending'
    };
    write(KEYS.adminInvites, [invite, ...getLocalAdminInvites()]);
    return invite;
  });
}

function acceptAdminInvite(code) {
  if (storageMode === 'cloud') return callCloud('acceptAdminInvite', { code });
  return Promise.resolve().then(() => {
    const invites = getLocalAdminInvites();
    const invite = invites.find((entry) => entry.code === String(code || '').trim());
    if (!invite || invite.status !== 'pending') throw new Error('邀请码无效或已失效');
    if (invite.expiresAt < Date.now()) throw new Error('邀请码已过期');
    const member = {
      openid: `local-${invite.code}`,
      role: 'member',
      joinedAt: Date.now(),
      joinedAtText: formatTime(Date.now()),
      removable: true
    };
    write(KEYS.adminMembers, [...getLocalAdminMembers(), member]);
    write(KEYS.adminInvites, invites.map((entry) => entry.code === invite.code ? { ...entry, status: 'used' } : entry));
    return member;
  });
}

function removeAdminMember(openid) {
  if (storageMode === 'cloud') return callCloud('removeAdminMember', { openid });
  return Promise.resolve().then(() => {
    const before = getLocalAdminMembers();
    const after = before.filter((entry) => entry.openid !== openid);
    if (after.length === before.length) throw new Error('后台成员不存在');
    write(KEYS.adminMembers, after);
    return { success: true };
  });
}

function listEmployees() {
  return storageMode === 'cloud' ? callCloud('listEmployees') : Promise.resolve(read(KEYS.employees, []));
}

function saveEmployee(employee) {
  if (storageMode === 'cloud') return callCloud('saveEmployee', { employee });
  return Promise.resolve().then(() => {
    const fields = commissionRules.employeeInput(employee);
    const employees = read(KEYS.employees, []);
    const existing = employees.find((entry) => entry.id === employee.id);
    if (employee.id && !existing) throw new Error('游戏师不存在');
    const now = Date.now();
    const saved = {
      id: employee.id || createId('E'), ...fields,
      createdAt: existing ? existing.createdAt : now, updatedAt: now, updatedBy: 'local'
    };
    write(KEYS.employees, existing ? employees.map((entry) => entry.id === saved.id ? saved : entry) : [...employees, saved]);
    return saved;
  });
}

function listCommissionSettlements(filter = 'pending', offset = 0) {
  if (storageMode === 'cloud') return callCloud('listCommissionSettlements', { filter, offset });
  return Promise.resolve().then(() => {
    if (!['pending', 'all'].includes(filter) || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('提成记录查询参数无效');
    }
    const records = getSettlements().filter((entry) => filter === 'all' ||
      (entry.commission && entry.commission.payoutStatus === 'pending'))
      .sort((a, b) => b.closedAt - a.closedAt || String(b.id).localeCompare(String(a.id)))
      .slice(offset, offset + 20);
    return { records, nextOffset: offset + records.length, hasMore: records.length === 20 };
  });
}

function markCommissionPaid(settlementId) {
  if (storageMode === 'cloud') return callCloud('markCommissionPaid', { settlementId });
  return Promise.resolve().then(() => {
    const settlements = getSettlements();
    const settlement = settlements.find((entry) => entry.id === settlementId);
    if (!settlement || !settlement.commission ||
        !['pending', 'paid'].includes(settlement.commission.payoutStatus)) {
      throw new Error('该买单记录没有待发放提成');
    }
    if (settlement.commission.payoutStatus === 'paid') return settlement;
    const paidAt = Date.now();
    const saved = {
      ...settlement,
      commission: { ...settlement.commission, payoutStatus: 'paid', paidAt, paidAtText: formatTime(paidAt), paidBy: 'local' }
    };
    write(KEYS.settlements, settlements.map((entry) => entry.id === settlementId ? saved : entry));
    return saved;
  });
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
  getAdminProfile,
  getCustomerSession,
  getOrderAsync,
  getDashboard,
  getTableDetail,
  submitOrder,
  assignSpecialItem,
  settleTable,
  saveTableStaff,
  listAdminMembers,
  createAdminInvite,
  acceptAdminInvite,
  removeAdminMember,
  listEmployees,
  saveEmployee,
  listCommissionSettlements,
  markCommissionPaid,
  getMembers,
  rechargeMember
};
