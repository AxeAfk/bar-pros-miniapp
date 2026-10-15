const { formatMoney } = require('./format');

function commissionView(commission) {
  const calculated = commission && commission.amountCents !== null && commission.amountCents !== undefined;
  const payoutText = {
    pending: '未发放',
    paid: '已发放',
    not_required: '无需发放',
    uncalculated: '未核算'
  };
  let warning = '';
  if (!commission) {
    warning = '提成未核算。';
  } else if (commission.status === 'pending_staff') {
    warning = '本桌尚未绑定有效游戏师，普通商品和时长提成暂不能结算。';
  } else if (commission.status === 'pending_special_assignment') {
    warning = '存在未指定归属的特殊商品，请先由管理员指定提成游戏师。';
  }
  return {
    amountText: calculated ? formatMoney(commission.amountCents / 100) : '未核算',
    goodsText: calculated ? formatMoney((commission.goodsAmountCents || 0) / 100) : '未核算',
    sharedGoodsText: calculated ? formatMoney((commission.goodsSharedAmountCents || 0) / 100) : '未核算',
    specialGoodsText: calculated ? formatMoney((commission.specialAmountCents || 0) / 100) : '未核算',
    serviceText: calculated ? formatMoney((commission.serviceAmountCents || 0) / 100) : '未核算',
    warning,
    payoutText: commission ? (payoutText[commission.payoutStatus] || '') : '未核算',
    canPay: Boolean(commission && commission.payoutStatus === 'pending'),
    paidAtText: commission && commission.paidAtText || '',
    allocations: commission && commission.allocations
      ? commission.allocations.map((entry) => ({
        ...entry,
        amountText: formatMoney(entry.amountCents / 100),
        serviceAmountText: formatMoney(entry.serviceAmountCents / 100),
        goodsSharedAmountText: formatMoney(entry.goodsSharedAmountCents / 100),
        specialAmountText: formatMoney(entry.specialAmountCents / 100)
      }))
      : [],
    unassignedItems: commission && commission.unassignedItems
      ? commission.unassignedItems.map((entry) => ({
        ...entry,
        amountText: formatMoney(entry.amountCents / 100)
      }))
      : []
  };
}

function itemCommissionText(item) {
  if (!item || !item.commission) {
    return '提成待核算';
  }
  const prefix = item.commission.scope === 'designated' ? '指定提成' : '均分提成';
  const owner = item.commission.scope === 'designated'
    ? ` · ${item.commission.designatedStaffName || item.commission.designatedStaffId || '待指定'}`
    : '';
  return `${prefix} ${item.commission.rateBps / 100}%${owner} · ${formatMoney(item.commission.amountCents / 100)}`;
}

module.exports = { commissionView, itemCommissionText };
