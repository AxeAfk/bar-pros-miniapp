const store = require('../../services/store');
const { formatMoney, formatDuration } = require('../../utils/format');
const { hourlyServiceFee } = require('../../config/app');

Page({
  data: {
    order: null,
    totalText: '¥0.00',
    session: null
  },

  onLoad(options) {
    this.orderId = options.orderId;
    this.refresh();
  },

  onShow() {
    this.billTimer = setInterval(() => this.updateSessionClock(), 1000);
    this.billSyncTimer = setInterval(() => this.refresh(), 3000);
  },

  onHide() {
    this.clearBillTimer();
  },

  onUnload() {
    this.clearBillTimer();
  },

  clearBillTimer() {
    if (this.billTimer) {
      clearInterval(this.billTimer);
      this.billTimer = null;
    }
    if (this.billSyncTimer) {
      clearInterval(this.billSyncTimer);
      this.billSyncTimer = null;
    }
  },

  refresh() {
    if (this.billRequestPending || !this.orderId) {
      return;
    }
    this.billRequestPending = true;
    store.getOrderAsync(this.orderId).then((order) => {
      if (!order) {
        throw new Error('未找到对应电子账单');
      }
      return store.getCustomerSession(order.tableId, order.sessionId).then((session) => ({ order, session }));
    }).then(({ order, session }) => {
      this._sessionStartedAt = session ? session.startedAt : null;
      this._sessionItemTotal = session ? session.itemTotal : 0;
      this.setData({
        order: {
          ...order,
          items: order.items.map((item) => ({
            ...item,
            totalText: formatMoney(item.price * item.quantity)
          }))
        },
        totalText: formatMoney(order.totalAmount),
        session: session ? { ...session } : null
      });
      this.updateSessionClock();
      this._billErrorShown = false;
    }).catch((error) => {
      if (!this._billErrorShown) {
        wx.showModal({
          title: '账单读取失败',
          content: error.message || '请稍后重试',
          showCancel: false
        });
        this._billErrorShown = true;
      }
    }).then(() => {
      this.billRequestPending = false;
    });
  },

  updateSessionClock() {
    if (!this._sessionStartedAt) {
      return;
    }
    const elapsedMs = Math.max(0, Date.now() - this._sessionStartedAt);
    const billableHours = Math.max(1, Math.ceil(elapsedMs / (60 * 60 * 1000)));
    const serviceFee = billableHours * hourlyServiceFee;
    const itemTotal = this._sessionItemTotal;
    this.setData({
      session: {
        ...this.data.session,
        elapsedText: formatDuration(elapsedMs),
        billableHours,
        itemTotalText: formatMoney(itemTotal),
        serviceFeeText: formatMoney(serviceFee),
        totalText: formatMoney(itemTotal + serviceFee)
      }
    });
  },

  continueOrdering() {
    const order = this.data.order;
    if (!order || !order.tableId) {
      wx.showToast({ title: '账单尚未加载，请稍后重试', icon: 'none' });
      return;
    }
    wx.redirectTo({
      url: `/pages/menu/menu?tableId=${encodeURIComponent(order.tableId)}`
    });
  }
});
