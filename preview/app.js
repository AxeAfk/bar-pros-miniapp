const state = {
  page: "tables",
  activeCategory: "beer",
  table: null,
  cart: {},
  orders: [],
  member: {
    name: "模拟会员",
    phone: "13800000000",
    balance: 5200,
  },
};

const tables = [
  { id: "T01", name: "1号桌", area: "大厅" },
  { id: "T02", name: "2号桌", area: "大厅" },
  { id: "T03", name: "3号桌", area: "大厅" },
  { id: "T04", name: "4号桌", area: "大厅" },
  { id: "T05", name: "5号桌", area: "卡座" },
  { id: "T06", name: "6号桌", area: "卡座" },
];

const categories = [
  { id: "beer", name: "啤酒" },
  { id: "whisky", name: "洋酒" },
  { id: "cocktail", name: "鸡尾酒" },
  { id: "snack", name: "小吃" },
  { id: "set", name: "套餐" },
];

const products = [
  { id: "p001", categoryId: "beer", name: "百威啤酒", price: 38 },
  { id: "p002", categoryId: "beer", name: "科罗娜", price: 45 },
  { id: "p003", categoryId: "beer", name: "精酿 IPA", price: 58 },
  { id: "p004", categoryId: "whisky", name: "芝华士 12 年", price: 588 },
  { id: "p005", categoryId: "whisky", name: "杰克丹尼", price: 528 },
  { id: "p006", categoryId: "cocktail", name: "莫吉托", price: 68 },
  { id: "p007", categoryId: "cocktail", name: "长岛冰茶", price: 78 },
  { id: "p008", categoryId: "snack", name: "薯条", price: 32 },
  { id: "p009", categoryId: "snack", name: "炸鸡拼盘", price: 88 },
  { id: "p010", categoryId: "set", name: "6瓶啤酒套餐", price: 198 },
  { id: "p011", categoryId: "set", name: "洋酒畅饮套餐", price: 888 },
];

const rechargePlans = [
  { id: "r5000", amount: 5000, gift: 300 },
  { id: "r10000", amount: 10000, gift: 800 },
  { id: "r20000", amount: 20000, gift: 2000 },
];

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function cartItems() {
  return products
    .filter((product) => state.cart[product.id])
    .map((product) => ({
      ...product,
      quantity: state.cart[product.id],
      total: product.price * state.cart[product.id],
    }));
}

function cartTotal() {
  return cartItems().reduce((sum, item) => sum + item.total, 0);
}

function setPage(page) {
  state.page = page;
  document.querySelectorAll(".tabbar button").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  render();
}

function renderTables() {
  const activeTableIds = state.orders.map((order) => order.table.id);
  return `
    <div class="section row">
      <div>
        <div class="title">DODO BAR</div>
        <div class="subtitle">扫码点单 · 提交订单 · 个人号演示版</div>
      </div>
      <button class="secondary" style="width:96px;margin:0" onclick="setPage('admin')">管理</button>
    </div>
    <div class="grid">
      ${tables
        .map(
          (table) => `
        <div class="section table-card" onclick="openMenu('${table.id}')">
          <div class="row">
            <strong>${table.name}</strong>
            <span class="tag">${activeTableIds.includes(table.id) ? "消费中" : "空闲"}</span>
          </div>
          <div class="subtitle">${table.area} · ${table.id}</div>
          <button class="primary">开始点单</button>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function renderMenu() {
  const table = state.table || tables[0];
  const items = products.filter(
    (product) => product.categoryId === state.activeCategory,
  );
  return `
    <div class="section">
      <div class="row">
        <div>
          <div class="title">${table.name}</div>
          <div class="subtitle">选择酒水后提交订单</div>
        </div>
        <div class="price">${money(cartTotal())}</div>
      </div>
    </div>
    <div class="tabs">
      ${categories
        .map(
          (category) => `
        <button class="pill ${category.id === state.activeCategory ? "active" : ""}" onclick="selectCategory('${category.id}')">
          ${category.name}
        </button>
      `,
        )
        .join("")}
    </div>
    ${items
      .map(
        (product) => `
      <div class="section row">
        <div>
          <strong>${product.name}</strong>
          <div class="subtitle">${money(product.price)}</div>
        </div>
        <div class="counter">
          <button class="round minus" onclick="changeQty('${product.id}', -1)">-</button>
          <span>${state.cart[product.id] || 0}</span>
          <button class="round" onclick="changeQty('${product.id}', 1)">+</button>
        </div>
      </div>
    `,
      )
      .join("")}
    <div class="checkout">
      <div>
        <div class="muted">共 ${cartItems().reduce((sum, item) => sum + item.quantity, 0)} 件</div>
        <div class="price">${money(cartTotal())}</div>
      </div>
      <button class="primary" onclick="pay()">提交订单</button>
    </div>
  `;
}

function renderBill(order) {
  return `
    <div class="section">
      <div class="title">下单成功</div>
      <div class="subtitle">${order.table.name} · ${order.createdAt}</div>
      <div class="subtitle">订单已提交，等待商家确认</div>
      ${order.items
        .map(
          (item) => `
        <div class="row list-row">
          <div>
            <strong>${item.name}</strong>
            <div class="subtitle">x ${item.quantity}</div>
          </div>
          <div class="price">${money(item.total)}</div>
        </div>
      `,
        )
        .join("")}
      <div class="row" style="margin-top:16px">
        <strong>合计</strong>
        <div class="price">${money(order.total)}</div>
      </div>
      <div class="subtitle">订单号：${order.id}</div>
      <div class="subtitle">订单状态：已提交</div>
    </div>
    <button class="primary" onclick="setPage('tables')">继续点单</button>
  `;
}

function renderMember() {
  return `
    <div class="section">
      <div class="title">会员信息</div>
      <div class="subtitle">个人号版本先展示会员资料，线上充值后续开放</div>
    </div>
    <div class="section row">
      <div>
        <strong>${state.member.name}</strong>
        <div class="subtitle">${state.member.phone}</div>
      </div>
      <div class="price">${money(state.member.balance)}</div>
    </div>
    <div class="section">
      <strong>当前说明</strong>
      <div class="subtitle" style="margin-top:12px">
        顾客可先扫码下单，会员充值与线上支付留待个体户/企业主体版本接入。
      </div>
    </div>
  `;
}

function renderAdmin() {
  const revenue = state.orders.reduce((sum, order) => sum + order.total, 0);
  return `
    <div class="section">
      <div class="title">管理员后台</div>
      <div class="subtitle">单角色全权限 · 订单 / 桌台 / 会员概览</div>
    </div>
    <div class="stats">
      <div class="section">
        <div class="muted">今日订单</div>
        <div class="stat">${state.orders.length}</div>
      </div>
      <div class="section">
        <div class="muted">订单金额</div>
        <div class="stat price">${money(revenue)}</div>
      </div>
    </div>
    <div class="section">
      <strong>最近订单</strong>
      ${
        state.orders.length
          ? state.orders
              .map(
                (order) => `
        <div class="list-row">
          <div class="row">
            <div>
              <strong>${order.table.name}</strong>
              <div class="subtitle">${order.createdAt}</div>
            </div>
            <div class="price">${money(order.total)}</div>
          </div>
          <div class="subtitle">已提交 · ${order.id}</div>
        </div>
      `,
              )
              .join("")
          : '<div class="subtitle">暂无订单</div>'
      }
    </div>
  `;
}

function render() {
  const screen = document.querySelector("#screen");
  if (state.page === "tables") screen.innerHTML = renderTables();
  if (state.page === "menu") screen.innerHTML = renderMenu();
  if (state.page === "bill") screen.innerHTML = renderBill(state.orders[0]);
  if (state.page === "member") screen.innerHTML = renderMember();
  if (state.page === "admin") screen.innerHTML = renderAdmin();
}

function openMenu(tableId) {
  state.table = tables.find((table) => table.id === tableId);
  state.cart = {};
  setPage("menu");
}

function selectCategory(categoryId) {
  state.activeCategory = categoryId;
  render();
}

function changeQty(productId, delta) {
  state.cart[productId] = Math.max((state.cart[productId] || 0) + delta, 0);
  if (!state.cart[productId]) delete state.cart[productId];
  render();
}

function pay() {
  const items = cartItems();
  if (!items.length) {
    alert("请先选择商品");
    return;
  }
  state.orders.unshift({
    id: `O${Date.now()}`,
    table: state.table,
    items,
    total: cartTotal(),
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  });
  state.cart = {};
  setPage("bill");
}

function recharge(planId) {
  return planId;
}

document.querySelectorAll(".tabbar button").forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

render();
