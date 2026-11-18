"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.contextSize = contextSize;
exports.decide = decide;
exports.getTextEngine = getTextEngine;
exports.infer = infer;
exports.inferStream = inferStream;
exports.inferStructured = inferStructured;
exports.resetContext = resetContext;
var _index = require("./index");
// Stands in for the on-device toolkit's entry ('@/lib/mera-protocol-toolkit' in the app): the
// phone's built-in text model and Kev. Every member is asynchronous, and on a host without
// on-device models each one fails as a rejected promise (a stream on its first read), never a
// synchronous throw: callers attach `.catch` to the call. resetContext is the exception: with no
// model there is no context, so it resolves.

function model() {
  const m = (0, _index.platform)('on-device-model').onDeviceModel;
  if (!m) throw new Error('The host has no on-device models (lib/platform/on-device-model)');
  return m;
}
async function infer(params) {
  return model().infer(params);
}
async function* inferStream(params, signal) {
  yield* model().inferStream(params, signal);
}
async function inferStructured(params) {
  return model().inferStructured(params);
}
async function decide(request) {
  return model().decide(request);
}
async function contextSize(engine) {
  return model().contextSize(engine);
}
async function resetContext() {
  await (0, _index.platform)('on-device-model').onDeviceModel?.resetContext();
}
async function getTextEngine() {
  return model().getTextEngine();
}