// Stub so tests/integration/punishments.test.ts compiles and fails by name on CI before the route exists
// (shyden-labs/ShyTalk#310).
export interface ShyDeskCallbackEnv {
  ENVIRONMENT_NAME: 'prod' | 'test' | 'dev';
  SHYDESK_CALLBACK_SECRET?: string;
}

export const handleShyDeskCallback: (request: Request, env: ShyDeskCallbackEnv) => Promise<Response> = () =>
  Promise.resolve(new Response('{}', { status: 501 }));
