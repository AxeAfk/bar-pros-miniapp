const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');
const { checkoutMode } = require('../../config/app');

Page({
  data: {
    stats: {
      orderCount: 0,
      revenueText: '¥0.00'
    },
    amountLabel: checkoutMode === 'order_only' ? '订单金额' : '今日营收',
    tables: [],
    orders: []
  },

  onShow() {
    const stats = store.getTodayStats();
    this.setData({
      stats: {
        ...stats,
        revenueText: formatMoney(stats.revenue)
      },
      tables: store.getTables().map((table) => ({
        ...table,
        statusText: table.status === 'using' ? '消费中' : '空闲'
      })),
      orders: store.getOrders().slice(0, 10).map((order) => ({
        ...order,
        statusText: order.status === 'submitted' ? '已提交' : order.status === 'paid' ? '已支付' : '待支付',
        totalText: formatMoney(order.totalAmount)
      }))
    });
  },

  goTables() {
    wx.switchTab({
      url: '/pages/tables/tables'
    });
  }
});
