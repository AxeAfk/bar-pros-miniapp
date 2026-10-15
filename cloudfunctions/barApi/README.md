# barApi deployment

The mini program uses this cloud function for persistent tables, orders, active sessions, and settlements. Create these cloud database collections before deploying:

- `bar_tables`
- `bar_sessions`
- `bar_orders`
- `bar_settlements`

Set each collection's client read and write permissions to deny access. The mini program accesses records through `barApi`; its admin operations are checked server-side.

Create database indexes for the queried fields: `bar_sessions.tableId`, `bar_tables.id`, `bar_orders.createdAt`, `bar_orders.sessionId + createdAt`, and `bar_settlements.closedAt`.

Before launch:

1. Set `cloudEnvId` in `config/app.js` to the target CloudBase environment ID.
2. Deploy `barApi` with its dependencies and configure the `ADMIN_OPENIDS` environment variable as a comma-separated list of administrator OpenIDs.
3. Add the same environment ID to the WeChat DevTools project and verify an authorized admin account can open the management page.
4. Generate six table QR codes that open `pages/entry/entry` with scene values `table_id=1` through `table_id=6`. Direct page queries use `pages/entry/entry?table_id=1` through `pages/entry/entry?table_id=6`.

The management page polls the cloud dashboard every three seconds and displays
a toast when it detects a new order. Administrators can also tap the subscription
button to request WeChat service notifications individually. The configured
template is `wO1VECzgDEqinluVIXOxcNb_GLUca7AV2txXiMth0Mk`: `thing1` is the
ordered-product summary (limited to 20 characters), `time2` is order time, and
`thing6` identifies the table/customer or proxy order.

Deploy `barApi` including `config.json` (permission `subscribeMessage.send`) and
`order-notifications.js`, then upload the mini program. Confirm the template is
added to this mini program and its approved scenario permits administrator
order notifications. Set the function timeout to 60 seconds. `ADMIN_OPENIDS`
must include every recipient's real OpenID for this mini program; each recipient
must personally subscribe. One-time templates consume a subscription opportunity
per notification; "always allow" does not grant unlimited sends.

After the order transaction commits, the function attempts delivery to all
distinct allowlisted administrators, including for proxy orders. Failed delivery
(including exhausted consent) is logged with order/recipient information and
does not roll back or report failure for a committed order. There is no automatic
retry or guaranteed delivery; check cloud logs and retain the dashboard as the
order source of truth. Notification visibility/sound depends on WeChat and phone
settings. Do not assume a long-term template without checking platform eligibility.

The entry page routes valid table parameters directly to the menu regardless of
role. Without table parameters, `isAdmin` checks the server-side `ADMIN_OPENIDS`
allowlist: administrators enter the backend, while customers see a scan prompt
and a camera button. The separate table-home interface has been removed.
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
`settleTable`, passing `expected: { sessionId, totalAmount }`. The transaction
rejects a changed session or total (including hourly fee changes), requiring the
administrator to reopen and verify the bill. Deploy this API change together
with the updated mini program. Settlement records persist after clearing.

The admin record panel switches between the latest 10 orders and latest 10
settlements (across all dates). Each successful received-payment confirmation
creates one settlement, including table, closing time, duration, goods amount,
service fee and total. Viewing or dismissing a bill does not create a record.
Existing settlement records are displayed without recreating them.
