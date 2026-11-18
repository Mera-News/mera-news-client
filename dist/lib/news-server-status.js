"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NEWS_SERVER_STATUS = void 0;
var _client = require("@apollo/client");
// What a news server says about itself. Only a news server answers it: Mera's own API does not, so a
// host sends it to a person's own news server or through a pod, never to Mera.
const NEWS_SERVER_STATUS = exports.NEWS_SERVER_STATUS = (0, _client.gql)`
  query NewsServerStatus {
    newsServerStatus {
      placesSeeded
      lastArticleAt
      lastClusteringAt
      lastTopicLinkAt
      headlineEditionsBuilt
      vectorIndexState
      embeddingModel
    }
  }
`;