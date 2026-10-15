const { rechargePlans, memberRechargeEnabled } = require('../../config/app');
const store = require('../../services/store');
const { formatMoney } = require('../../utils/format');

Page({
  data: {
    members: [],
    plans: [],
    selectedPlanId: 'r5000',
    memberRechargeEnabled
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({
      members: store.getMembers().map((member) => ({
        ...member,
        balanceText: formatMoney(member.balance)
      })),
      plans: rechargePlans.map((plan) => ({
        ...plan,
        amountText: formatMoney(plan.amount),
        giftText: formatMoney(plan.gift)
      }))
    });
  },

  selectPlan(event) {
    this.setData({
      selectedPlanId: event.currentTarget.dataset.id
    });
  },

  recharge() {
    if (!memberRechargeEnabled) {
      wx.showToast({ title: '个人号版本未开放充值', icon: 'none' });
      return;
    }

    const plan = rechargePlans.find((item) => item.id === this.data.selectedPlanId);
    const member = this.data.members[0];
    if (!plan || !member) {
      wx.showToast({ title: '缺少充值信息', icon: 'none' });
      return;
    }

    store.rechargeMember({
      memberId: member.id,
      amount: plan.amount,
      gift: plan.gift
    });
    this.refresh();
    wx.showToast({ title: '充值成功' });
  }
});
