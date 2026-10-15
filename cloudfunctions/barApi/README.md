# barApi deployment

The mini program uses this cloud function for persistent tables, orders, active sessions, and settlements. Create these cloud database collections before deploying:

- `bar_tables`
- `bar_sessions`
- `bar_orders`
- `bar_settlements`
- `bar_employees`
- `bar_admin_members`
- `bar_admin_invites`

Set each collection's client read and write permissions to deny access. The mini program accesses records through `barApi`; its admin operations are checked server-side.

Create database indexes for the queried fields: `bar_sessions.tableId`, `bar_tables.id`, `bar_orders.createdAt`, `bar_orders.sessionId + createdAt`, and `bar_settlements.closedAt`.
For employee/commission management, also create `bar_employees.createdAt` (ascending),
`bar_settlements.closedAt + id` (both descending), and
`bar_settlements.commission.payoutStatus` (ascending) + `closedAt + id` (descending).
For backend membership, also create `bar_admin_members.joinedAt` (ascending) and
`bar_admin_invites.createdAt` (descending).

Before launch:

1. Set `cloudEnvId` in `config/app.js` to the target CloudBase environment ID.
2. Deploy `barApi` with its dependencies and configure `OWNER_OPENID` as the sole super-admin OpenID. `ADMIN_OPENIDS` is only kept as a backward-compatible fallback when `OWNER_OPENID` is empty.
3. Add the same environment ID to the WeChat DevTools project and verify an authorized admin account can open the management page.
4. Generate six table QR codes that open `pages/entry/entry` with scene values `table_id=1` through `table_id=6`. Direct page queries use `pages/entry/entry?table_id=1` through `pages/entry/entry?table_id=6`.

The management page polls the cloud dashboard every three seconds and displays
a toast when it detects a new order. WeChat subscription messages and the
subscription button have been removed; remote order notifications use only the
WeCom group robot.

Deploy `barApi` including `config.json` and `order-notifications.js`, then upload
and release the mini program to remove the old subscription UI. No subscription
template or OpenAPI subscription-message permission is needed. Set the function
timeout to 60 seconds. `OWNER_OPENID` controls bootstrap administrator
authorization; invited members are stored in the database. It does not affect
notification recipients.

### WeCom (企业微信) group robot

Optionally set the `WECOM_WEBHOOK_URL` environment variable on `barApi` to a
WeCom group robot webhook (`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`).
Every committed order, including proxy orders, then posts a markdown message
(table, source, time, items with subtotals, order total) to that group.
No per-recipient subscription is required. Keep the webhook key secret;
do not commit it. Leaving the variable empty disables this channel. Failures
(invalid key, rate limit of 20 messages/minute, 5-second timeout) are logged and
never fail the committed order. Markdown is rendered in the WeCom client.
There is no automatic retry or guaranteed delivery; check cloud logs and retain
the dashboard as the order source of truth. Notification visibility and sound
depend on WeCom and phone settings.

The entry page routes valid table parameters directly to the menu regardless of
role. Without table parameters, `isAdmin` checks the server-side `OWNER_OPENID`
fallback plus the database member list: administrators enter the backend, while
customers see a scan prompt and a camera button. The separate table-home
interface has been removed.
The old `pages/tables/tables` path is a routing-only alias for existing printed
codes. Admin actions remain authorized server-side. Continue-ordering stays
on the bill's bound table.

The customer menu presents all on-sale products in one uncategorized list.
The official 14-drink catalog is kept in the supplied display order in
`config/mockData.js` and the server pricing catalog in `index.js`. Deploy both
the mini program and `barApi` together when changing prices. Retired product
IDs are not reassigned; existing order snapshots retain their original names
and prices.
Its sticky bill card highlights the current table's accumulated total, with
ordered goods and time charges below it. The total excludes unsubmitted items.
The fixed bottom dock is labeled as pending items and submits only that cart;
selecting quantities does not change the accumulated bill until submission.

Occupied table cards have a buy-bill button. Opening or dismissing the bill never
settles a table. Only the explicit received-payment confirmation calls
`settleTable`, passing `expected: { sessionId, totalAmount, commissionAmountCents }`.
The transaction rejects a changed session or total, requiring the administrator
to reopen and verify the bill. Settlement records persist after clearing.

The admin record panel switches between the latest 10 orders and latest 10
settlements (across all dates). Each successful received-payment confirmation
creates one settlement, including table, closing time, duration, goods amount,
service fee and total. Viewing or dismissing a bill does not create a record.
Existing settlement records are displayed without recreating them.

## Employee commissions

Ordinary products inherit a 20% shared commission. Champagne (`p019`) and
Hennessy VSOP (`p020`) use an explicit designated-employee rule in both product
catalogs:

```js
commission: { scope: 'designated', rateBps: 3000 }
```

`rateBps` is an integer from 0 through 10000 (basis points): 3000 means 30%;
5000 means 50%. To add future 50% or other products, configure the rate in
`config/mockData.js` and the server catalog in `index.js`; do not branch on
product names. The server is the authority and ignores customer-supplied rates,
prices and commission amounts.

New order items snapshot
`commission: { version, scope, rateBps, amountCents, designatedStaffId? }`.
Each item line is rounded half-up to the nearest cent after multiplying price by
quantity and rate. Customer prices, totals and charges remain unchanged.
Changing a catalog rule affects future orders only, not existing orders or
settled commissions.

### Dynamic timing and commission model

- Service fee is no longer rounded up by whole hours. It is calculated from
  staff timeline segments: `99 元/小时 × 当段在台游戏师数 × 实际时长`.
- Opening a table or adjusting staff closes the previous segment at the current
  timestamp and starts a new one with the updated staff list.
- Service-fee commission is 20% of each segment's service fee, split evenly
  across the employees in that segment.
- Ordinary goods commission is 20% and is split evenly across all employees who
  participated in any segment of that table session.
- Designated goods commission is 100% assigned to the chosen employee on that
  line item.

Customer-side ordering never exposes employee names. If a designated-commission
product is ordered by a customer while exactly one employee is on duty, that
employee is assigned automatically. Otherwise the order is rejected and the
administrator must place the item from the backend while explicitly choosing the
employee.

### Management workflow

- Open **后台成员管理** in the staff page. The unique owner can generate a
  one-time invite QR code; the invited WeChat user scans it and is inserted into
  `bar_admin_members`. The owner can later remove any invited member, but cannot
  remove the owner account itself.
- Open **游戏师管理** from the admin page. Add/edit/disable game masters; they do
  not need a WeChat login. There is no destructive delete operation.
- From the dashboard, use **开台绑定游戏师** or **调整游戏师**. Saving a change writes
  a new timestamped staff segment immediately.
- At checkout, expand **游戏师提成预览（内部）**. The system shows the split by
  game master automatically: service fee, shared goods, and designated goods.
- Confirm received payment to persist the settlement and computed allocations
  together and clear the table atomically. Game master names are snapshotted so
  subsequent edits or deactivation do not change history.
- Commission details are kept directly on each settlement record. There is no
  separate commission summary or payout workflow page for now.
- Game-master, backend-member, and settlement APIs require owner/member authorization.
  Customer order/session APIs omit commission data. The checkout commission
  section is collapsed initially so the customer-facing bill is unchanged.

### Existing data and rollout

Existing orders are not repriced and old settlements are never rewritten.
`utils/commission.js` remains the portable calculation/validation source used by
local mode, and tests enforce byte-for-byte parity with the deployed cloud copy.

Before rollout:

1. Create `bar_employees`, deny all client reads/writes, and add the indexes above.
2. Deploy `barApi` with the updated `commission.js`, `index.js`, and
   `config.json` (it now needs `wxacode.getUnlimited` permission for invite QR).
3. Upload/release the mini program with the updated admin/menu/bill pages at
   the same time.
4. Add at least one active employee and verify: table open, staff change,
   designated goods ordering, settlement preview, and payout confirmation.

No automatic backfill, employee payouts, or production database changes are
performed by deploying the code.
