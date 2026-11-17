// Integration setup. The platform host is registered first, because package modules read it
// as they load; then the in-process backend. Each area adds its own extras in its file below.
import './platform';
import './backend';
import './llm';
import './database';
import './services';
