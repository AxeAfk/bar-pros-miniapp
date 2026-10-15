const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event) => {
  if (!event) {
    throw new Error('无效的微信支付回调');
  }

  return {
    received: true,
    event
  };
};
