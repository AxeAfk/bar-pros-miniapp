module.exports = {
  cloudEnvId: '',
  releaseMode: 'personal',
  checkoutMode: 'order_only',
  enableMockPayment: true,
  memberRechargeEnabled: false,
  shop: {
    name: 'DODO BAR',
    phone: '请补充店铺电话',
    address: '请补充店铺地址'
  },
  rechargePlans: [
    { id: 'r5000', amount: 5000, gift: 300 },
    { id: 'r10000', amount: 10000, gift: 800 },
    { id: 'r20000', amount: 20000, gift: 2000 }
  ]
};
