"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.blockIfOnDevice = blockIfOnDevice;
exports.cloudOnlyNoticeText = cloudOnlyNoticeText;
exports.showCloudOnlyNotice = showCloudOnlyNotice;
var _dialog = require("../platform/dialog");
var _onDeviceGate = require("./on-device-gate");
// ONE in-app message for every cloud-only action a reader triggers while the
// app is on-device (never a native alert, never a silent failure). Shared copy:
// `chat.cloudOnlyNotice`. Background jobs skip silently instead; see
// on-device-gate.ts. The i18n instance is required lazily (lib/i18n pulls the
// OS translator's native module at load).

/** The shared body line, in the reader's language. */
function cloudOnlyNoticeText() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18n = require("../platform/i18n").default;
  return i18n.t('chat.cloudOnlyNotice');
}

/** The dialog (one OK button). Resolves once it is dismissed. */
async function showCloudOnlyNotice() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const i18n = require("../platform/i18n").default;
  await (0, _dialog.showDialog)({
    title: i18n.t('meraProtocol.title'),
    body: cloudOnlyNoticeText(),
    confirmLabel: i18n.t('common.ok')
  });
}

/** True (after showing the notice) when the action must not run on-device.
 *  `purpose: 'chat'` lets it run while cloud chat is on. */
async function blockIfOnDevice(purpose) {
  if (await (0, _onDeviceGate.cloudAllowed)(purpose)) return false;
  void showCloudOnlyNotice();
  return true;
}