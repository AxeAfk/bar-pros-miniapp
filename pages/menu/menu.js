const store = require('../../services/store');
const { formatMoney, formatDuration } = require('../../utils/format');
const { normalizeTableId } = require('../../utils/entry');
const { hourlyServiceFee } = require('../../config/app');
const { calculateServiceFeeCents } = require('../../utils/commission');

function isDesignatedProduct(product) {
  const commission = product && product.commission;
  return Boolean(commission && (commission.scope === 'designated' || commission.kind === 'special'));
}

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
    checkoutButtonText: '提交订单',
    specialStaffOptions: [],
    specialStaffHint: ''
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
    this.specialAssignments = {};
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
    if (options.source === 'admin') {
      this.refreshAdminOrderContext();
    }
  },

  onShow() {
    this.sessionTimer = setInterval(() => this.updateSessionClock(), 1000);
    this.sessionSyncTimer = setInterval(() => this.refreshSession(), 3000);
    this.refreshAdminStatus();
    if (this.data.isAdminOrder) {
      this.adminOrderSyncTimer = setInterval(() => this.refreshAdminOrderContext(), 3000);
    }
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
    if (this.adminOrderSyncTimer) {
      clearInterval(this.adminOrderSyncTimer);
      this.adminOrderSyncTimer = null;
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

  refreshAdminOrderContext() {
    if (!this.data.tableId) return;
    store.getTableDetail(this.data.tableId).then((summary) => {
      const specialStaffOptions = summary && Array.isArray(summary.currentStaff) ? summary.currentStaff : [];
      Object.keys(this.specialAssignments).forEach((productId) => {
        if (!specialStaffOptions.some((entry) => entry.id === this.specialAssignments[productId])) {
          delete this.specialAssignments[productId];
        }
      });
      if (specialStaffOptions.length === 1) {
        this.products.filter(isDesignatedProduct).forEach((product) => {
          if (!this.specialAssignments[product.id]) {
            this.specialAssignments[product.id] = specialStaffOptions[0].id;
          }
        });
      }
      this.setData({
        specialStaffOptions,
        specialStaffHint: specialStaffOptions.length
          ? `当前在台游戏师：${specialStaffOptions.map((entry) => entry.name).join('、')}`
          : '当前桌台还未绑定在台游戏师，特殊商品需要先回后台绑定游戏师'
      });
      this.refreshProducts();
    }).catch((error) => {
      wx.showToast({ title: error.message || '游戏师信息读取失败', icon: 'none' });
    });
  },

  refreshSession() {
    if (!this.data.tableId || this.sessionRequestPending) {
      return;
    }
    this.sessionRequestPending = true;
    store.getCustomerSession(this.data.tableId).then((summary) => {
      this._sessionErrorShown = false;
      this._liveSession = summary ? { ...summary } : null;
      this._sessionStartedAt = summary ? summary.startedAt : null;
      this._sessionItemTotalCents = summary ? (summary.itemTotalCents || Math.round(summary.itemTotal * 100)) : 0;
      this._serviceFeeBaseCents = summary ? (summary.serviceFeeCents || Math.round(summary.serviceFee * 100)) : 0;
      this._serviceFeeBaseAt = summary ? (summary.pricedAt || Date.now()) : 0;
      this._currentServiceRateCentsPerHour = summary ? (summary.currentServiceRateCentsPerHour || 0) : 0;
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
    const now = Date.now();
    const liveSession = this._liveSession;
    const sessionStartedAt = liveSession ? liveSession.startedAt : this._sessionStartedAt;
    const elapsedMs = sessionStartedAt ? Math.max(0, now - sessionStartedAt) : 0;
    const serviceFeeCents = liveSession
      ? calculateServiceFeeCents(liveSession, now, hourlyServiceFee)
      : (sessionStartedAt ? this._serviceFeeBaseCents : 0);
    const itemTotalCents = liveSession
      ? (liveSession.itemTotalCents || Math.round(liveSession.itemTotal * 100))
      : (sessionStartedAt ? this._sessionItemTotalCents : 0);
    const elapsedText = sessionStartedAt ? formatDuration(elapsedMs) : '00:00:00';
    this.setData({
      sessionActive: Boolean(sessionStartedAt),
      elapsedText,
      timerHint: sessionStartedAt ? `已消费 ${elapsedText}` : '首单提交后开始计时',
      itemTotalText: formatMoney(itemTotalCents / 100),
      serviceFeeText: formatMoney(serviceFeeCents / 100),
      sessionTotalText: formatMoney((itemTotalCents + serviceFeeCents) / 100)
    });
  },

  refreshProducts() {
    const assignments = this.specialAssignments || {};
    const visibleProducts = this.products.map((product) => {
      const specialStaffOptions = this.data.specialStaffOptions || [];
      const designatedStaffId = assignments[product.id] || '';
      const selectedStaffIndex = specialStaffOptions.findIndex((entry) => entry.id === designatedStaffId);
      return {
        ...product,
        isDesignated: isDesignatedProduct(product),
        quantity: this.cart[product.id] || 0,
        priceText: formatMoney(product.price),
        specialCommissionText: isDesignatedProduct(product) ? `特殊商品 · ${product.commission.rateBps / 100}% 定向提成` : '',
        selectedStaffId: designatedStaffId,
        selectedStaffIndex
      };
    });
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
    if (!this.specialAssignments) this.specialAssignments = {};
    this.cart[productId] = (this.cart[productId] || 0) + 1;
    if (this.data.isAdminOrder && this.data.specialStaffOptions.length === 1) {
      const product = this.products.find((entry) => entry.id === productId);
      if (product && isDesignatedProduct(product)) {
        this.specialAssignments[productId] = this.data.specialStaffOptions[0].id;
      }
    }
    this.refreshProducts();
  },

  decrease(event) {
    const productId = event.currentTarget.dataset.id;
    if (!this.specialAssignments) this.specialAssignments = {};
    this.cart[productId] = Math.max(0, (this.cart[productId] || 0) - 1);
    if (this.cart[productId] === 0) {
      delete this.specialAssignments[productId];
    }
    this.refreshProducts();
  },

  chooseSpecialStaff(event) {
    if (!this.specialAssignments) this.specialAssignments = {};
    const productId = event.currentTarget.dataset.id;
    const index = Number(event.detail.value);
    const employee = this.data.specialStaffOptions[index];
    if (!employee) return;
    this.specialAssignments[productId] = employee.id;
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
        quantity: this.cart[product.id],
        designatedStaffId: this.specialAssignments[product.id] || ''
      }));
    if (!items.length) {
      wx.showToast({ title: '请先选择商品', icon: 'none' });
      return;
    }
    if (this.data.isAdminOrder) {
      for (const item of items) {
        const product = this.products.find((entry) => entry.id === item.productId);
        if (product && isDesignatedProduct(product) && !item.designatedStaffId) {
          wx.showToast({ title: `${product.name} 需要先指定提成游戏师`, icon: 'none' });
          return;
        }
      }
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
      this.specialAssignments = {};
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
