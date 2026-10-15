const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadApi({ adminMembers = [], employees = [], missingCollections = [], missingDocuments = [], openid = 'admin' } = {}) {
  const missing = new Set(missingCollections);
  const missingDocKeys = new Set(missingDocuments);
  const collection = (name) => ({
    _offset: 0,
    _limit: 100,
    where(filter) { this.filter = filter; return this; },
    orderBy(field) {
      if (name === 'bar_admin_members' || name === 'bar_employees') {
        throw new Error(`unexpected orderBy on ${name}.${field}`);
      }
      return this;
    },
    skip(value) { this._offset = value; return this; },
    limit(value) { this._limit = value; return this; },
    async get() {
      if (missing.has(name)) {
        throw new Error(`collection ${name} does not exist`);
      }
      if (name === 'bar_admin_members') {
        return { data: adminMembers.slice(this._offset, this._offset + this._limit) };
      }
      if (name === 'bar_employees') {
        return { data: employees.slice(this._offset, this._offset + this._limit) };
      }
      return { data: [] };
    },
    doc(id) {
      return {
        async get() {
          if (missing.has(name)) {
            throw new Error(`collection ${name} does not exist`);
          }
          if (missingDocKeys.has(`${name}:${id}`)) {
            throw new Error(`document.get:fail document with _id ${id} does not exist`);
          }
          if (name === 'bar_admin_members') {
            return { data: adminMembers.find((entry) => entry.openid === id) || null };
          }
          if (name === 'bar_employees') {
            return { data: employees.find((entry) => entry.id === id) || null };
          }
          return { data: null };
        },
        async set() {
          if (missing.has(name)) {
            throw new Error(`collection ${name} does not exist`);
          }
        },
        async update() {
          if (missing.has(name)) {
            throw new Error(`collection ${name} does not exist`);
          }
        },
        async remove() {
          if (missing.has(name)) {
            throw new Error(`collection ${name} does not exist`);
          }
        }
      };
    }
  });
  const db = { collection, runTransaction: async (callback) => callback({ collection }) };
  const cloud = {
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid }),
    DYNAMIC_CURRENT_ENV: 'test'
  };
  const context = {
    exports: {},
    console: { error() {} },
    require: (id) => {
      if (id === 'wx-server-sdk') return cloud;
      if (id === './order-notifications') return { notifyWecomRobot: async () => ({ success: true }) };
      return require(id.startsWith('.') ? path.join(__dirname, '..', 'cloudfunctions', 'barApi', id) : id);
    },
    process: { env: { ADMIN_OPENIDS: 'admin' } }
  };
  const file = path.join(__dirname, '..', 'cloudfunctions', 'barApi', 'index.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.exports.main;
}

test('listAdminMembers reads all pages without requiring a joinedAt index', async () => {
  const adminMembers = Array.from({ length: 101 }, (_, index) => ({
    openid: `member-${index + 1}`,
    status: 'active',
    joinedAt: 1000 + index,
    joinedAtText: `joined-${index + 1}`
  }));
  adminMembers[49].status = 'removed';
  const main = loadApi({ adminMembers });
  const result = await main({ action: 'listAdminMembers' });
  assert.equal(result.success, true);
  assert.equal(result.data.length, 101);
  assert.equal(result.data[0].role, 'owner');
  assert.equal(result.data[1].openid, 'member-1');
  assert.equal(result.data.at(-1).openid, 'member-101');
  assert.equal(result.data.some((entry) => entry.openid === 'member-50'), false);
});

test('listEmployees reads all pages without requiring a createdAt index', async () => {
  const employees = [
    { id: 'E3', name: 'Carol', createdAt: 3000, active: true },
    { id: 'E1', name: 'Alice', createdAt: 1000, active: true },
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `E${index + 10}`,
      name: `Employee ${index + 10}`,
      createdAt: 1100 + index,
      active: true
    })),
    { id: 'E2', name: 'Bob', createdAt: 2000, active: false }
  ];
  const main = loadApi({ employees });
  const result = await main({ action: 'listEmployees' });
  assert.equal(result.success, true);
  assert.equal(result.data.length, 103);
  assert.equal(result.data.slice(0, 3).map((entry) => entry.id).join(','), 'E1,E10,E11');
  assert.equal(result.data.at(-2).id, 'E2');
  assert.equal(result.data.at(-1).id, 'E3');
});

test('admin pages tolerate missing optional membership and employee collections', async () => {
  const main = loadApi({ missingCollections: ['bar_admin_members', 'bar_employees'] });
  const profile = await main({ action: 'getAdminProfile' });
  const members = await main({ action: 'listAdminMembers' });
  const employees = await main({ action: 'listEmployees' });
  assert.equal(profile.success, true);
  assert.equal(profile.data.isAdmin, true);
  assert.equal(profile.data.isOwner, true);
  assert.equal(members.success, true);
  assert.equal(members.data.length, 1);
  assert.equal(members.data[0].openid, 'admin');
  assert.equal(members.data[0].role, 'owner');
  assert.equal(members.data[0].removable, false);
  assert.equal(employees.success, true);
  assert.equal(employees.data.length, 0);
});

test('createAdminInvite returns a readable error when invite collection is missing', async () => {
  const main = loadApi({ missingCollections: ['bar_admin_invites'] });
  const result = await main({ action: 'createAdminInvite' });
  assert.equal(result.success, false);
  assert.match(result.error, /bar_admin_invites/);
});

test('missing admin-member documents are treated as absent instead of hard failures', async () => {
  const main = loadApi({
    openid: 'guest-openid',
    missingDocuments: ['bar_admin_members:guest-openid']
  });
  const isAdmin = await main({ action: 'isAdmin' });
  const profile = await main({ action: 'getAdminProfile' });
  assert.equal(isAdmin.success, true);
  assert.equal(isAdmin.data, false);
  assert.equal(profile.success, true);
  assert.equal(profile.data.isAdmin, false);
});
