// Integration setup. The platform host is registered first, because package modules read it
// as they load. Each area then adds its own setup file below.
import './platform';
import './llm';
import './database';
import './services';
