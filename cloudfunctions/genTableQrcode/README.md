# Generate table mini-program codes

Deploy this folder using WeChat DevTools **Upload and deploy: install dependencies in cloud**.
Select the same cloud environment as the mini program. Configure this function's
`ADMIN_OPENIDS` environment variable with the same administrator allowlist as `barApi`.
The allowlist is per function; configuring `barApi` alone is not sufficient.
Deploy `config.json` with the `wxacode.getUnlimited` OpenAPI permission.
Set the function timeout to 60 seconds for the six-code batch.

Run this in the mini program debugger console while signed in with an authorized
WeChat account (not a cloud console test without a real user context):

```javascript
wx.cloud.callFunction({
  name: 'genTableQrcode',
  data: { range: { from: 1, to: 6 }, envVersion: 'trial' }
}).then(({ result }) => {
  console.log(result);
  console.table(result.results);
}).catch(console.error);
```

Use `trial` only after uploading and selecting an experience version containing
`pages/entry/entry`. Scanning accounts must have the appropriate version access.
For public use, publish that page and generate again with `envVersion: 'release'`.
The default is `release`; `develop` is also accepted.

The default batch is tables 1 to 6. Alternatively pass `tableId: 1` or
`tableIds: [1, 3, 6]`. Do not combine selection modes.
Each image embeds `scene: 'table_id=N'`, which the existing entry parser supports.
The entry redirects table codes to the bound menu, administrators without table
parameters to the backend, and other visitors to a camera scan button.
Previously printed codes using `pages/tables/tables` remain supported by a
route-only compatibility page; the old table-list interface has been removed.

Successful entries return `fileID` and a temporary `url`. Download images through
those URLs or from cloud storage under `qrcode/tables/<envVersion>/table_N.png`.
Keep the version directories separate when printing. Temporary URL expiration
does not expire the downloaded code image.

Partial failures are logged and returned per table; top-level `success` is false
if any table failed. If upload succeeded but URL lookup failed, the entry retains
its `fileID` so the image can still be retrieved from cloud storage.
Retry failed table IDs after correcting the error. Repeated generation overwrites
the same version/table image. No production orders or sessions are modified.
