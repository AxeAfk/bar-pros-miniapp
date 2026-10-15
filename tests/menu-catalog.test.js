const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { products, menuCategories } = require('../config/mockData');

const expected = [
  ['百威啤酒', 25],
  ['科罗娜', 30],
  ['福佳白', 30],
  ['百威铝罐', 40],
  ['青岛铝罐', 40],
  ['诱惑1号', 50],
  ['诱惑7号', 50],
  ['诱惑9号', 50],
  ['1664白啤', 50],
  ['香槟', 500],
  ['轩尼诗VSOP', 2500],
  ['动力苏打酒', 20],
  ['矿泉水', 10],
  ['可乐', 10]
];

test('customer catalog matches the official names, prices and display order', () => {
  assert.deepEqual(products.map(({ name, price }) => [name, price]), expected);
  assert.equal(new Set(products.map(({ id }) => id)).size, 14);
  assert.ok(products.every((product) => product.onSale));
  assert.ok(products.every((product) =>
    menuCategories.some((category) => category.id === product.categoryId)));
  assert.ok(products.slice(2).every((product) => Number(product.id.slice(1)) >= 12));
});

test('cloud pricing catalog matches the customer catalog without reusing retired IDs', () => {
  const cloud = { init() {}, database: () => ({}) };
  const context = {
    exports: {},
    require: (id) => id === 'wx-server-sdk' ? cloud
      : require(id.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'barApi', id) : id)
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js'), 'utf8'
  );
  vm.runInNewContext(`${source}\nexports.catalog = products;`, context);
  const catalog = JSON.parse(JSON.stringify(context.exports.catalog));
  assert.deepEqual(catalog, products.map(({ categoryId, ...product }) => product));
  assert.deepEqual(catalog.map(({ name, price }) => [name, price]), expected);
});
