const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

function createNonce() {
  return crypto.randomBytes(16).toString('hex');
}

exports.main = async (event) => {
  const { orderId, amount, description } = event;
  const subMchId = process.env.WECHAT_PAY_SUB_MCH_ID;
  const envId = process.env.WECHAT_CLOUD_ENV_ID || process.env.TCB_ENV;
  const notifyFunction = process.env.WECHAT_PAY_NOTIFY_FUNCTION || 'paymentNotify';

  if (!orderId || !amount || amount < 1) {
    throw new Error('缺少有效订单号或支付金额');
  }

  if (!subMchId || !envId) {
    throw new Error('请先配置 WECHAT_PAY_SUB_MCH_ID 和 WECHAT_CLOUD_ENV_ID 环境变量');
  }

  if (!cloud.cloudPay || !cloud.cloudPay.unifiedOrder) {
    throw new Error('当前云环境未开通或未安装微信支付能力');
  }

  const payment = await cloud.cloudPay.unifiedOrder({
    body: description || '酒水订单',
    outTradeNo: orderId,
    spbillCreateIp: '127.0.0.1',
    subMchId,
    totalFee: amount,
    envId,
    functionName: notifyFunction,
    nonceStr: createNonce()
  });

  return {
    outTradeNo: orderId,
    description,
    amount,
    payment: payment.payment
  };
};
