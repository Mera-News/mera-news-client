// Stands in for the app's lib/navigation/resume-spot. A host with no screens has no spot to keep.
import { platform } from './index';

export function captureSpot(): unknown {
  return platform('resume-spot').captureSpot?.() ?? null;
}
