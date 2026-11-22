import { test, expect } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import RootLayout from '../../src/app/_layout.tsx';
import Home from '../../src/app/index.tsx';

// The app opens through its root layout onto the first screen (plan 6.1 Task 1).
test('the root layout opens on the first screen, with no header bar over it', async () => {
  await renderRouter({ _layout: RootLayout, index: Home }, { initialUrl: '/' });
  expect(screen.getByRole('header')).toHaveTextContent('ShyTalk');
  // The header bar is native: the stack's header config says whether it is drawn.
  const headers = screen.container.queryAll((node) => node.type === 'RNSScreenStackHeaderConfig');
  expect(headers.map((node) => (node.props as { hidden?: boolean }).hidden)).toEqual([true]);
});
