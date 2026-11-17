// Stands in for '@react-native-community/netinfo' (default export). Throws while loading when the
// host has no network module, which callers that load it in a try read as "module absent".
import { platform, type NetInfoLike } from './index';

export type { NetInfoState } from './index';

const host = platform('netinfo');
if (!host.netInfo) throw new Error('The host provides no network status (lib/platform/netinfo)');

const NetInfo: NetInfoLike = {
  fetch: () => platform('netinfo').netInfo!.fetch(),
  addEventListener: (listener) => platform('netinfo').netInfo!.addEventListener(listener),
};

export default NetInfo;
