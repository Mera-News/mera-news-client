// Stands in for the app's lib/apollo-client (default export: the GraphQL client).
import type { ApolloClient } from '@apollo/client';
import { forward } from './index';

const client: ApolloClient = forward('apollo-client', (host) => host.apolloClient);

export default client;
