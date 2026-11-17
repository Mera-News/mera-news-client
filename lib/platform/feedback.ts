// Stands in for the app's lib/feedback. A host without a feedback sink reports nothing sent.
import { platform } from './index';

export function submitFeatureRequest(title: string, summary: string): boolean {
  return platform('feedback').submitFeatureRequest?.(title, summary) ?? false;
}
