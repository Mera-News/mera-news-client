"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _sqliteAdapter = _interopRequireDefault(require("../platform/sqlite-adapter"));
var _logger = _interopRequireDefault(require("../logger"));
var _migrations = _interopRequireDefault(require("./migrations"));
var _schema = _interopRequireDefault(require("./schema"));
var _ArticleSuggestion = _interopRequireDefault(require("./models/ArticleSuggestion"));
var _ArticleSuggestionFact = _interopRequireDefault(require("./models/ArticleSuggestionFact"));
var _Conversation = _interopRequireDefault(require("./models/Conversation"));
var _Fact = _interopRequireDefault(require("./models/Fact"));
var _Message = _interopRequireDefault(require("./models/Message"));
var _InferenceJob = _interopRequireDefault(require("./models/InferenceJob"));
var _SchedulerJob = _interopRequireDefault(require("./models/SchedulerJob"));
var _Setting = _interopRequireDefault(require("./models/Setting"));
var _UserPersona = _interopRequireDefault(require("./models/UserPersona"));
var _PublicationVisit = _interopRequireDefault(require("./models/PublicationVisit"));
var _SavedArticleSuggestion = _interopRequireDefault(require("./models/SavedArticleSuggestion"));
var _ArticleFeedback = _interopRequireDefault(require("./models/ArticleFeedback"));
var _Topic = _interopRequireDefault(require("./models/Topic"));
var _Location = _interopRequireDefault(require("./models/Location"));
var _PublicationPreference = _interopRequireDefault(require("./models/PublicationPreference"));
var _PersonaSuppression = _interopRequireDefault(require("./models/PersonaSuppression"));
var _PersonaChangeLog = _interopRequireDefault(require("./models/PersonaChangeLog"));
var _StoryImpression = _interopRequireDefault(require("./models/StoryImpression"));
var _Notification = _interopRequireDefault(require("./models/Notification"));
var _PersonaSummaryString = _interopRequireDefault(require("./models/PersonaSummaryString"));
var _TrackedStory = _interopRequireDefault(require("./models/TrackedStory"));
var _TranslationCache = _interopRequireDefault(require("./models/TranslationCache"));
var _FactCheckRecord = _interopRequireDefault(require("./models/FactCheckRecord"));
var _UserPublicationSubscription = _interopRequireDefault(require("./models/UserPublicationSubscription"));
var _DeclinedTopic = _interopRequireDefault(require("./models/DeclinedTopic"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The open waits on a lock the previous JS runtime still holds (an OTA or
// language restart) because plugins/withWatermelonBusyTimeout.js sets
// busy_timeout before journal_mode = WAL in the native open.
const adapter = new _sqliteAdapter.default({
  schema: _schema.default,
  migrations: _migrations.default,
  jsi: true,
  onSetUpError: error => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[WMDB setup error]', error, error?.message, error?.stack);
    }
    _logger.default.captureException(error, {
      tags: {
        source: 'watermelondb',
        method: 'onSetUpError'
      }
    });
  }
});
const database = new _watermelondb.Database({
  adapter,
  modelClasses: [_Fact.default, _ArticleSuggestion.default, _ArticleSuggestionFact.default, _Conversation.default, _Message.default, _UserPersona.default, _PublicationVisit.default, _SavedArticleSuggestion.default, _ArticleFeedback.default, _Setting.default, _InferenceJob.default, _SchedulerJob.default, _Topic.default, _Location.default, _PublicationPreference.default, _PersonaSuppression.default, _PersonaChangeLog.default, _StoryImpression.default, _Notification.default, _PersonaSummaryString.default, _TrackedStory.default, _TranslationCache.default, _FactCheckRecord.default, _UserPublicationSubscription.default, _DeclinedTopic.default]
});
var _default = exports.default = database;