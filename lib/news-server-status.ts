import { gql } from '@apollo/client';

// What a news server says about itself. Only a news server answers it: Mera's own API does not, so a
// host sends it to a person's own news server or through a pod, never to Mera.
export const NEWS_SERVER_STATUS = gql`
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

export interface NewsServerStatus {
  /** False: place search is offered but holds nothing yet, so an empty answer means "not loaded", not "no match". */
  placesSeeded: boolean;
  /** Null when that stage has never run. */
  lastArticleAt: string | null;
  lastClusteringAt: string | null;
  lastTopicLinkAt: string | null;
  headlineEditionsBuilt: boolean;
  vectorIndexState: string | null;
  embeddingModel: string | null;
}
