"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _schema = require("./schema");
Object.keys(_schema).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _schema[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _schema[key];
    }
  });
});
var _prompt = require("./prompt");
Object.keys(_prompt).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _prompt[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _prompt[key];
    }
  });
});
var _parse = require("./parse");
Object.keys(_parse).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _parse[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _parse[key];
    }
  });
});
var _readerPhrase = require("./reader-phrase");
Object.keys(_readerPhrase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _readerPhrase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _readerPhrase[key];
    }
  });
});