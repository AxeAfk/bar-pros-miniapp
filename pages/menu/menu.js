const store = require('../../services/store');
const { formatMoney, formatDuration } = require('../../utils/format');
const { normalizeTableId } = require('../../utils/entry');
const { hourlyServiceFee } = require('../../config/app');

Page({
  data: {
    tableId: '',
    tableName: '',
    isAdmin: false,
    isAdminOrder: false,
    visibleProducts: [],
    cartCount: 0,
    productCount: 0,
    hourlyServiceFee,
    cartTotalText: '¥0.00',
    itemTotalText: '¥0.00',
    serviceFeeText: '¥0.00',
    sessionTotalText: '¥0.00',
    elapsedText: '00:00:00',
    timerHint: '首单提交后开始计时',
    sessionActive: false,
    submitting: false,
    checkoutButtonText: '提交订单'
  },

  onLoad(options) {
    const tableId = normalizeTableId(options.table_id || options.tableId);
    const table = store.getTableById(tableId);
    if (!table) {
      wx.showToast({ title: '桌号无效', icon: 'none' });
      return;
    }

    const menu = store.getMenu();
    this.cart = {};
    this.setData({
      tableId: table.id,
      tableName: table.name,
      isAdminOrder: options.source === 'admin',
      checkoutButtonText: options.source === 'admin' ? '确认代客下单' : '提交订单',
      productCount: menu.products.length
    });
    this.products = menu.products;
    this.refreshProducts();
    this.refreshSession();
  },

  onShow() {
    this.sessionTimer = setInterval(() => this.updateSessionClock(), 1000);
    this.sessionSyncTimer = setInterval(() => this.refreshSession(), 3000);
    this.refreshAdminStatus();
  },

  onHide() {
    this.clearSessionTimer();
  },

  onUnload() {
    this.clearSessionTimer();
  },

  clearSessionTimer() {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
    if (this.sessionSyncTimer) {
      clearInterval(this.sessionSyncTimer);
      this.sessionSyncTimer = null;
    }
  },

  refreshAdminStatus() {
    store.isAdmin().then((isAdmin) => {
      this.setData({ isAdmin });
    }).catch((error) => {
      this.setData({ isAdmin: false });
      if (!this._adminStatusErrorShown) {
        wx.showToast({ title: error.message || '管理员身份读取失败', icon: 'none' });
        this._adminStatusErrorShown = true;
      }
    });
  },

  refreshSession() {
    if (!this.data.tableId) {
      return;
    }
    if (this.sessionRequestPending) {
      return;
    }
    this.sessionRequestPending = true;
    store.getCustomerSession(this.data.tableId).then((summary) => {
      this._sessionErrorShown = false;
      this._sessionStartedAt = summary ? summary.startedAt : null;
      this._sessionItemTotal = summary ? summary.itemTotal : 0;
      this.updateSessionClock();
    }).catch((error) => {
      if (!this._sessionErrorShown) {
        wx.showToast({ title: error.message || '读取台次信息失败', icon: 'none' });
        this._sessionErrorShown = true;
      }
    }).then(() => {
      this.sessionRequestPending = false;
    });
  },

  updateSessionClock() {
    const elapsedMs = this._sessionStartedAt ? Math.max(0, Date.now() - this._sessionStartedAt) : 0;
    const billableHours = Math.max(1, Math.ceil(elapsedMs / (60 * 60 * 1000)));
    const serviceFee = this._sessionStartedAt ? billableHours * hourlyServiceFee : 0;
    const itemTotal = this._sessionStartedAt ? this._sessionItemTotal : 0;
    const elapsedText = this._sessionStartedAt ? formatDuration(elapsedMs) : '00:00:00';
    this.setData({
      sessionActive: Boolean(this._sessionStartedAt),
      elapsedText,
      timerHint: this._sessionStartedAt ? `已消费 ${elapsedText}` : '首单提交后开始计时',
      itemTotalText: formatMoney(itemTotal),
      serviceFeeText: formatMoney(serviceFee),
      sessionTotalText: formatMoney(itemTotal + serviceFee)
    });
  },

  refreshProducts() {
    const visibleProducts = this.products
      .map((product) => ({
        ...product,
        quantity: this.cart[product.id] || 0,
        priceText: formatMoney(product.price)
      }));
    const cartItems = this.products.filter((product) => this.cart[product.id] > 0);
    const cartCount = cartItems.reduce((sum, product) => sum + this.cart[product.id], 0);
    const cartTotal = cartItems.reduce((sum, product) => sum + product.price * this.cart[product.id], 0);
    this.setData({
      visibleProducts,
      cartCount,
      cartTotalText: formatMoney(cartTotal)
    });
  },

  increase(event) {
    const productId = event.currentTarget.dataset.id;
    this.cart[productId] = (this.cart[productId] || 0) + 1;
    this.refreshProducts();
  },

  decrease(event) {
    const productId = event.currentTarget.dataset.id;
    this.cart[productId] = Math.max(0, (this.cart[productId] || 0) - 1);
    this.refreshProducts();
  },

  submitOrder() {
    if (this.data.submitting) {
      return;
    }
    const items = this.products
      .filter((product) => this.cart[product.id] > 0)
      .map((product) => ({
        productId: product.id,
        quantity: this.cart[product.id]
      }));
    if (!items.length) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    store.submitOrder({
      tableId: this.data.tableId,
      tableName: this.data.tableName,
      items,
      payMethod: 'order',
      source: this.data.isAdminOrder ? 'admin' : 'customer'
    }).then((order) => {
      this.cart = {};
      this.refreshProducts();
      if (this.data.isAdminOrder) {
        wx.showToast({ title: '代客下单成功' });
        setTimeout(() => wx.navigateBack(), 300);
        return;
      }
      wx.navigateTo({
        url: `/pages/bill/bill?orderId=${encodeURIComponent(order.id)}`
      });
    }).catch((error) => {
      wx.showToast({ title: error.message || '订单提交失败', icon: 'none' });
    }).then(() => {
      this.setData({ submitting: false });
    });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  }
});
