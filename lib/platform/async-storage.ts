// Stands in for '@react-native-async-storage/async-storage' (default export).
import { forward } from './index';

const AsyncStorage = forward('async-storage', (host) => host.asyncStorage);

export default AsyncStorage;
