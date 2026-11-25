/**
 * The Worker's own roadmap object (shyden-labs/ShyTalk#321): the runtime builds it with its `ctx` and env, and it
 * reads ShyTalk's board as the read-only App the env names: `ROADMAP_APP_ID` and `ROADMAP_INSTALLATION_ID` (vars in
 * workers/web/wrangler.json) and `ROADMAP_APP_KEY` (a secret each deploy puts). A read without one fails naming it,
 * which the object keeps to itself (object.ts).
 */
import { workersRuntime } from '../app/announcer.ts';
import { SHYTALK } from './hook-route.ts';
import { readRoadmapBoard, type GithubFetch, type RoadmapApp } from './github.ts';
import { Roadmap as RoadmapCore, type RoadmapDeps, type RoadmapState } from './object.ts';

/** The board's recorded title, asserted before its items are used (ShyTalk's CLAUDE.md). */
const BOARD_TITLE = 'ShyTalk Stories';

export interface RoadmapEnv {
  ROADMAP_APP_ID?: string;
  ROADMAP_INSTALLATION_ID?: string;
  ROADMAP_APP_KEY?: string;
  /** Where GitHub's API answers: GitHub itself unless the CI smoke names its stand-in on this machine. */
  ROADMAP_GITHUB_API?: string;
}

/** The App the env names, or throws naming the first setting it lacks. */
function appOf(env: RoadmapEnv): RoadmapApp {
  const { ROADMAP_APP_ID: appId, ROADMAP_INSTALLATION_ID: installationId, ROADMAP_APP_KEY: key } = env;
  if (!appId) throw new Error('roadmap: ROADMAP_APP_ID is not set');
  if (!installationId) throw new Error('roadmap: ROADMAP_INSTALLATION_ID is not set');
  if (!key) throw new Error('roadmap: ROADMAP_APP_KEY is not set');
  return { appId, installationId, key, board: { id: SHYTALK.boardId, title: BOARD_TITLE } };
}

export function roadmapDeps(env: RoadmapEnv, send: GithubFetch = (url, init) => fetch(url, init)): RoadmapDeps {
  return {
    readBoard: async () => readRoadmapBoard(appOf(env), send, Date.now()),
    now: () => Date.now(),
    runtime: workersRuntime,
  };
}

export class Roadmap extends RoadmapCore {
  constructor(ctx: RoadmapState, env: RoadmapEnv) {
    super(ctx, env, roadmapDeps(env));
  }
}
