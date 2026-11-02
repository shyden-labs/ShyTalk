import { describe, it, expect } from 'vitest';
import * as door from '../../workers/door/src/index.ts';
import * as echo from '../../workers/echo/src/index.ts';
import * as web from '../../workers/web/src/index.ts';

/**
 * The Workers runtime treats every named export of a Worker's main module as
 * an entrypoint and refuses to start if one is not a handler or class
 * (`Incorrect type for map entry`, shyden-labs/ShyTalk#51's first smoke run).
 * So a main module exports its default handler and Durable Object classes only;
 * constants and helpers live in a module beside it.
 */
const entries = { door, echo, web };

describe('each Worker main module', () => {
  it.each(Object.entries(entries))('%s exports a default handler and classes only', (_name, mod) => {
    const named = Object.entries(mod).filter(([key]) => key !== 'default');
    const notClasses = named
      .filter(([, value]) => !(typeof value === 'function' && /^class\b/.test(Function.prototype.toString.call(value))))
      .map(([key]) => key);
    expect(notClasses).toEqual([]);
    expect(typeof (mod as { default?: { fetch?: unknown } }).default?.fetch).toBe('function');
  });
});
