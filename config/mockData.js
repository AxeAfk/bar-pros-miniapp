const tables = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1;
  const tableCode = String(number).padStart(2, '0');
  return {
    id: `T${tableCode}`,
    name: `${number}号桌`,
    area: '大厅',
    status: 'idle'
  };
});

const menuCategories = [
  { id: 'beer', name: '啤酒' },
  { id: 'wine', name: '香槟' },
  { id: 'whisky', name: '洋酒' },
  { id: 'drink', name: '其他饮品' }
];

const products = [
  { id: 'p001', categoryId: 'beer', name: '百威啤酒', price: 25, onSale: true },
  { id: 'p002', categoryId: 'beer', name: '科罗娜', price: 30, onSale: true },
  { id: 'p012', categoryId: 'beer', name: '福佳白', price: 30, onSale: true },
  { id: 'p013', categoryId: 'beer', name: '百威铝罐', price: 40, onSale: true },
  { id: 'p014', categoryId: 'beer', name: '青岛铝罐', price: 40, onSale: true },
  { id: 'p015', categoryId: 'beer', name: '诱惑1号', price: 50, onSale: true },
  { id: 'p016', categoryId: 'beer', name: '诱惑7号', price: 50, onSale: true },
  { id: 'p017', categoryId: 'beer', name: '诱惑9号', price: 50, onSale: true },
  { id: 'p018', categoryId: 'beer', name: '1664白啤', price: 50, onSale: true },
  { id: 'p019', categoryId: 'wine', name: '香槟', price: 500, onSale: true },
  { id: 'p020', categoryId: 'whisky', name: '轩尼诗VSOP', price: 2500, onSale: true },
  { id: 'p021', categoryId: 'drink', name: '动力苏打酒', price: 20, onSale: true },
  { id: 'p022', categoryId: 'drink', name: '矿泉水', price: 10, onSale: true },
  { id: 'p023', categoryId: 'drink', name: '可乐', price: 10, onSale: true }
];

module.exports = {
  tables,
  menuCategories,
  products
};
