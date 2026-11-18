"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _UserPublicationSubscription;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A publication the user has told us they pay for. Long-lived, user-owned,
 * and DEVICE-ONLY — there is no server-side `userId -> publisher` row anywhere
 * in this feature, by decision.
 *
 * Two things this row is for: prioritising the publication in scoring (through
 * the existing `publication_preferences` machinery, not a new axis), and
 * surfacing "From your subscriptions" on article detail.
 */
/**
 * `'declined'` is a resting state in its own right, not a deleted
 * subscription. It records that the user answered No to the "Did you subscribe
 * to X?" prompt, so the prompt never fires for that publisher again. Only
 * `'active'` rows match articles or render in the list.
 */
let UserPublicationSubscription = exports.default = (_dec = (0, _decorators.text)('publisher_id'), _dec2 = (0, _decorators.text)('publisher_name'), _dec3 = (0, _decorators.text)('publisher_name_norm'), _dec4 = (0, _decorators.text)('country_code'), _dec5 = (0, _decorators.field)('subscription_uri'), _dec6 = (0, _decorators.text)('source_names_json'), _dec7 = (0, _decorators.field)('status'), _dec8 = (0, _decorators.date)('subscribed_at'), _dec9 = (0, _decorators.date)('created_at'), _dec0 = (0, _decorators.date)('updated_at'), _class = (_UserPublicationSubscription = class UserPublicationSubscription extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    /** Mongo `_id` of the `NewsPublisher`. The stable identity of the row. */
    _initializerDefineProperty(this, "publisherId", _descriptor, this);
    /** Display name, as the publisher record spells it. */
    _initializerDefineProperty(this, "publisherName", _descriptor2, this);
    /** `publisherName` through the shared publication-name normalisation. */
    _initializerDefineProperty(this, "publisherNameNorm", _descriptor3, this);
    /**
     * Whatever the publisher record carries. Usually ISO alpha-3, but not
     * always: "The Next Web" is `'GLOBAL'`. Never assume three letters.
     */
    _initializerDefineProperty(this, "countryCode", _descriptor4, this);
    /**
     * The publisher's own subscribe/pricing page, snapshotted at add time.
     * NULL is a first-class value meaning the publisher has no consumer
     * subscription product, not missing data.
     */
    _initializerDefineProperty(this, "subscriptionUri", _descriptor5, this);
    /**
     * JSON `string[]` of every NORMALISED source name belonging to this
     * publisher. This is what article matching runs against, never
     * `publisherNameNorm`.
     *
     * Articles carry a bare `publication_name`, which is the SOURCE's name, and
     * a source's name is not guaranteed equal to its publisher's name. Matching
     * on the publisher name alone silently misses coverage, which is the whole
     * reason this column exists. Read it through
     * `user-publication-subscription-service.parseSourceNames`, which tolerates
     * a malformed blob rather than throwing on the render path.
     */
    _initializerDefineProperty(this, "sourceNamesJson", _descriptor6, this);
    _initializerDefineProperty(this, "status", _descriptor7, this);
    /** When the user told us they subscribe. Survives a cancel and re-add. */
    _initializerDefineProperty(this, "subscribedAt", _descriptor8, this);
    _initializerDefineProperty(this, "createdAt", _descriptor9, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor0, this);
  }
}, _UserPublicationSubscription.table = 'user_publication_subscriptions', _UserPublicationSubscription), _descriptor = _applyDecoratedDescriptor(_class.prototype, "publisherId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "publisherName", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "publisherNameNorm", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "countryCode", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "subscriptionUri", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "sourceNamesJson", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "subscribedAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);