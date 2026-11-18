"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  REASON_V1_ID: true,
  REASON_V3_ID: true,
  PRE_GEO_CONTROL_ID: true,
  REASON_RESCORE_ID: true,
  REASON_RESCORE_PRIOR_ID: true,
  RESCORE_DEMOTE_ONLY_ID: true,
  NULL_CONTROL_ID: true
};
Object.defineProperty(exports, "NULL_CONTROL_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.NULL_CONTROL_ID;
  }
});
Object.defineProperty(exports, "PRE_GEO_CONTROL_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.PRE_GEO_CONTROL_ID;
  }
});
Object.defineProperty(exports, "REASON_RESCORE_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.REASON_RESCORE_ID;
  }
});
Object.defineProperty(exports, "REASON_RESCORE_PRIOR_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.REASON_RESCORE_PRIOR_ID;
  }
});
Object.defineProperty(exports, "REASON_V1_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.REASON_V1_ID;
  }
});
Object.defineProperty(exports, "REASON_V3_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.REASON_V3_ID;
  }
});
Object.defineProperty(exports, "RESCORE_DEMOTE_ONLY_ID", {
  enumerable: true,
  get: function () {
    return _reasonArms.RESCORE_DEMOTE_ONLY_ID;
  }
});
var _types = require("./core/types");
Object.keys(_types).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _types[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _types[key];
    }
  });
});
var _ports = require("./core/ports");
Object.keys(_ports).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _ports[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _ports[key];
    }
  });
});
var _proposals = require("./core/proposals");
Object.keys(_proposals).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _proposals[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _proposals[key];
    }
  });
});
var _config = require("./core/config");
Object.keys(_config).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _config[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _config[key];
    }
  });
});
var _prompts = require("./prompts/prompts");
Object.keys(_prompts).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _prompts[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _prompts[key];
    }
  });
});
var _reasonArms = require("./prompts/reason-arms");
var _questionnaireData = require("./prompts/questionnaire-data");
Object.keys(_questionnaireData).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _questionnaireData[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _questionnaireData[key];
    }
  });
});
var _factRules = require("./persona-management/fact-rules");
Object.keys(_factRules).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _factRules[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _factRules[key];
    }
  });
});
var _topicGeneration = require("./persona-management/topic-generation");
Object.keys(_topicGeneration).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _topicGeneration[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _topicGeneration[key];
    }
  });
});
var _personaAgentCore = require("./persona-management/persona-agent-core");
Object.keys(_personaAgentCore).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _personaAgentCore[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _personaAgentCore[key];
    }
  });
});
var _scoring = require("./article-pipeline/scoring");
Object.keys(_scoring).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _scoring[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _scoring[key];
    }
  });
});
var _scoringDecode = require("./article-pipeline/scoring-decode");
Object.keys(_scoringDecode).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _scoringDecode[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _scoringDecode[key];
    }
  });
});
var _tagPrompt = require("./article-pipeline/tag-prompt");
Object.keys(_tagPrompt).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _tagPrompt[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _tagPrompt[key];
    }
  });
});
var _candidates = require("./article-pipeline/candidates");
Object.keys(_candidates).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _candidates[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _candidates[key];
    }
  });
});
var _pipeline = require("./article-pipeline/pipeline");
Object.keys(_pipeline).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _pipeline[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _pipeline[key];
    }
  });
});
var _reasonGrounding = require("./article-pipeline/reason-grounding");
Object.keys(_reasonGrounding).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _reasonGrounding[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _reasonGrounding[key];
    }
  });
});
var _agentCore = require("./article-feedback/agent-core");
Object.keys(_agentCore).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _agentCore[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _agentCore[key];
    }
  });
});
var _personaContext = require("./scoring-engine/persona-context");
Object.keys(_personaContext).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _personaContext[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _personaContext[key];
    }
  });
});
var _geo = require("./scoring-engine/geo");
Object.keys(_geo).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _geo[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _geo[key];
    }
  });
});
var _suppression = require("./scoring-engine/suppression");
Object.keys(_suppression).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _suppression[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _suppression[key];
    }
  });
});
var _relevance = require("./scoring-engine/relevance");
Object.keys(_relevance).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _relevance[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _relevance[key];
    }
  });
});
var _calibration = require("./scoring-engine/calibration");
Object.keys(_calibration).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _calibration[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _calibration[key];
    }
  });
});
var _runStage = require("./scoring-engine/run-stage");
Object.keys(_runStage).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _runStage[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _runStage[key];
    }
  });
});
var _retrievalProfile = require("./scoring-engine/retrieval-profile");
Object.keys(_retrievalProfile).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _retrievalProfile[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _retrievalProfile[key];
    }
  });
});
var _supranationalCodes = require("./scoring-engine/supranational-codes");
Object.keys(_supranationalCodes).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _supranationalCodes[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _supranationalCodes[key];
    }
  });
});
var _ownership = require("./feed-select/ownership");
Object.keys(_ownership).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _ownership[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _ownership[key];
    }
  });
});