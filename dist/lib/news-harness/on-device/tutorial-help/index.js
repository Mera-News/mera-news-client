"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
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