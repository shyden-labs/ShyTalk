import { test, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Home from '../../src/app/index.tsx';

// The app's first screen draws (plan 6.1 Task 1): real React Native under
// jest-expo, the runner Task 1 measured (.superpowers/sdd/11/runner-measure.md).
test('the first screen names ShyTalk as its heading', async () => {
  await render(<Home />);
  expect(screen.getByRole('header')).toHaveTextContent('ShyTalk');
});
