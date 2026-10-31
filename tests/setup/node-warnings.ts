// A node warning (process.emitWarning, a deprecation) fails the run: the
// listener throws on the tick node emits it, and vitest reports the error.
import { failOnNodeWarning } from './warnings.ts';

process.on('warning', failOnNodeWarning);
