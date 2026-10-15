const tables = [
  { id: 'T01', name: '1号桌', area: '大厅', status: 'idle' },
  { id: 'T02', name: '2号桌', area: '大厅', status: 'idle' },
  { id: 'T03', name: '3号桌', area: '大厅', status: 'idle' },
  { id: 'T04', name: '4号桌', area: '大厅', status: 'idle' },
  { id: 'T05', name: '5号桌', area: '卡座', status: 'idle' },
  { id: 'T06', name: '6号桌', area: '卡座', status: 'idle' }
];

const menuCategories = [
  { id: 'beer', name: '啤酒' },
  { id: 'whisky', name: '洋酒' },
  { id: 'cocktail', name: '鸡尾酒' },
  { id: 'snack', name: '小吃' },
  { id: 'set', name: '套餐' }
];

const products = [
  { id: 'p001', categoryId: 'beer', name: '百威啤酒', price: 38, onSale: true },
  { id: 'p002', categoryId: 'beer', name: '科罗娜', price: 45, onSale: true },
  { id: 'p003', categoryId: 'beer', name: '精酿 IPA', price: 58, onSale: true },
  { id: 'p004', categoryId: 'whisky', name: '芝华士 12 年', price: 588, onSale: true },
  { id: 'p005', categoryId: 'whisky', name: '杰克丹尼', price: 528, onSale: true },
  { id: 'p006', categoryId: 'cocktail', name: '莫吉托', price: 68, onSale: true },
  { id: 'p007', categoryId: 'cocktail', name: '长岛冰茶', price: 78, onSale: true },
  { id: 'p008', categoryId: 'snack', name: '薯条', price: 32, onSale: true },
  { id: 'p009', categoryId: 'snack', name: '炸鸡拼盘', price: 88, onSale: true },
  { id: 'p010', categoryId: 'set', name: '6瓶啤酒套餐', price: 198, onSale: true },
  { id: 'p011', categoryId: 'set', name: '洋酒畅饮套餐', price: 888, onSale: true }
];

module.exports = {
  tables,
  menuCategories,
  products
};
