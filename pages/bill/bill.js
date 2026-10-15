const store = require('../../services/store');
const { formatMoney, formatDuration } = require('../../utils/format');
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
      this._sessionItemTotalCents = session ? (session.itemTotalCents || Math.round(session.itemTotal * 100)) : 0;
      this._serviceFeeBaseCents = session ? (session.serviceFeeCents || Math.round(session.serviceFee * 100)) : 0;
      this._serviceFeeBaseAt = session ? (session.pricedAt || Date.now()) : 0;
      this._currentServiceRateCentsPerHour = session ? (session.currentServiceRateCentsPerHour || 0) : 0;
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
    const serviceFeeCents = this._serviceFeeBaseCents + Math.round(
      Math.max(0, Date.now() - this._serviceFeeBaseAt) * this._currentServiceRateCentsPerHour / (60 * 60 * 1000)
    );
    const itemTotalCents = this._sessionItemTotalCents;
    this.setData({
      session: {
        ...this.data.session,
        elapsedText: formatDuration(elapsedMs),
        itemTotalText: formatMoney(itemTotalCents / 100),
        serviceFeeText: formatMoney(serviceFeeCents / 100),
        totalText: formatMoney((itemTotalCents + serviceFeeCents) / 100)
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
