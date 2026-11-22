// Testing Library's matchers (toHaveTextContent and the rest) are registered at
// run time; their types extend '@jest/expect', but Jest 30's `expect` from
// @jest/globals is typed by the 'expect' package, so they are added there.
import type { JestNativeMatchers } from '@testing-library/react-native/dist/matchers/types';

declare module 'expect' {
  // A merged interface repeats Jest's own type parameters, so T stays though the matchers do not use it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-object-type -- merges into Jest's own interface.
  interface Matchers<R extends void | Promise<void>, T = unknown> extends JestNativeMatchers<R> {}
}
