const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');
const { checkoutMode } = require('../../config/app');

Page({
  data: {
    order: null,
    totalText: '¥0.00',
    billTitle: checkoutMode === 'order_only' ? '下单成功' : '支付成功',
    billHint: checkoutMode === 'order_only' ? '订单已提交，等待商家确认' : '订单已支付完成'
  },

  onLoad(options) {
    const order = store.getOrder(options.orderId);
    if (!order) {
      wx.showModal({
        title: '订单不存在',
        content: '未找到对应电子账单',
        showCancel: false
      });
      return;
    }
    this.setData({
      order: {
        ...order,
        items: order.items.map((item) => ({
          ...item,
          totalText: formatMoney(item.price * item.quantity)
        }))
      },
      totalText: formatMoney(order.totalAmount)
    });
  },

  backToTables() {
    wx.switchTab({
      url: '/pages/tables/tables'
    });
  }
});
