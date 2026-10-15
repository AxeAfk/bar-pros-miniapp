const { tables, menuCategories, products } = require('../config/mockData');
const { enableMockPayment, checkoutMode } = require('../config/app');
const { createId, formatTime } = require('../utils/format');

const KEYS = {
  tables: 'bar_tables',
  orders: 'bar_orders',
  members: 'bar_members'
};

function read(key, fallback) {
  const value = wx.getStorageSync(key);
  return value || fallback;
}

function write(key, value) {
  wx.setStorageSync(key, value);
  return value;
}

function getTables() {
  const orders = getOrders();
  const activeTableIds = orders
    .filter((order) => ['submitted', 'paid'].includes(order.status))
    .map((order) => order.tableId);
  return read(KEYS.tables, tables).map((table) => ({
    ...table,
    status: activeTableIds.includes(table.id) ? 'using' : 'idle'
  }));
}

function getTableById(tableId) {
  const normalizedId = String(tableId || '').trim().toUpperCase();
  return getTables().find((table) => table.id.toUpperCase() === normalizedId);
}

function getMenu() {
  return {
    categories: menuCategories,
    products: products.filter((product) => product.onSale)
  };
}

function getOrders() {
  return read(KEYS.orders, []);
}

function getOrder(orderId) {
  return getOrders().find((order) => order.id === orderId);
}

function createOrder({ tableId, tableName, items, payMethod }) {
  const now = Date.now();
  const status = checkoutMode === 'order_only' ? 'submitted' : 'pending';
  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = {
    id: createId('O'),
    tableId,
    tableName,
    items,
    totalAmount,
    payMethod,
    status,
    createdAt: now,
    createdAtText: formatTime(now),
    submittedAt: status === 'submitted' ? now : null,
    submittedAtText: status === 'submitted' ? formatTime(now) : ''
  };
  const orders = [order, ...getOrders()];
  write(KEYS.orders, orders);
  return order;
}

function markOrderPaid(orderId, transactionId) {
  const orders = getOrders().map((order) => {
    if (order.id !== orderId) return order;
    return {
      ...order,
      status: 'paid',
      transactionId: transactionId || '',
      paidAt: Date.now(),
      paidAtText: formatTime(Date.now())
    };
  });
  write(KEYS.orders, orders);
  return getOrder(orderId);
}

function getTodayStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayOrders = getOrders().filter((order) => {
    const effectiveTime = order.paidAt || order.submittedAt || order.createdAt;
    return ['submitted', 'paid'].includes(order.status) && effectiveTime >= start.getTime();
  });
  return {
    orderCount: todayOrders.length,
    revenue: todayOrders.reduce((sum, order) => sum + order.totalAmount, 0)
  };
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

function payByMemberBalance({ orderId, memberId }) {
  const order = getOrder(orderId);
  const members = getMembers();
  const member = members.find((item) => item.id === memberId);

  if (!order) {
    throw new Error('订单不存在');
  }
  if (!member) {
    throw new Error('会员不存在');
  }
  if (member.balance < order.totalAmount) {
    throw new Error('会员余额不足');
  }

  write(KEYS.members, members.map((item) => {
    if (item.id !== memberId) return item;
    return {
      ...item,
      balance: item.balance - order.totalAmount
    };
  }));

  return markOrderPaid(orderId, `member-${memberId}`);
}

function requestWechatPayment(order) {
  if (enableMockPayment) {
    return Promise.resolve(markOrderPaid(order.id, 'mock-wechat-pay'));
  }

  return wx.cloud.callFunction({
    name: 'createPayment',
    data: {
      orderId: order.id,
      amount: Math.round(order.totalAmount * 100),
      description: `${order.tableName} 酒水订单`
    }
  }).then(({ result }) => {
    if (!result || !result.payment) {
      throw new Error('创建微信支付订单失败');
    }
    return new Promise((resolve, reject) => {
      wx.requestPayment({
        ...result.payment,
        success: () => resolve(markOrderPaid(order.id, result.outTradeNo)),
        fail: reject
      });
    });
  });
}

module.exports = {
  getTables,
  getTableById,
  getMenu,
  getOrders,
  getOrder,
  createOrder,
  markOrderPaid,
  getTodayStats,
  getMembers,
  rechargeMember,
  payByMemberBalance,
  requestWechatPayment
};
