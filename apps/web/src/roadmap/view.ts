/** Stub (shyden-labs/ShyTalk#321 AC3): the tests run red before the code exists. */
export type State = 'done' | 'started' | 'not started';
export interface Milestone {
  name: string | null;
  summary: string | null;
  brings: string[];
  closed: number;
  total: number;
  percent: number;
  state: State;
}
export interface Words {
  done: string;
  started: string;
  notStarted: string;
  labelDone: string;
  labelStarted: string;
  labelNotStarted: string;
  brings: string;
  close: string;
  bar: string;
  barLabel: string;
  mapLabel: string;
  unnamed: string;
  updated: string;
}
export type Lines = Record<string, string> | null;
export const SPOTS: [number, number][] = [];
export const escapeHtml = (text: string): string => text;
export const lineHtml: (english: string, lines: Lines) => string = (english) => english;
export const overallPercent: (milestones: Milestone[]) => number = () => -1;
export const firstOpen: (milestones: Milestone[]) => number = () => -2;
export const stateLabel: (milestone: Milestone, words: Words) => string = () => '';
export const mapSvg: (milestones: Milestone[], words: Words, lines: Lines) => string = () => '';
export const buttonsHtml: (milestones: Milestone[], words: Words, lines: Lines) => string = () => '';
export const panelHtml: (milestone: Milestone, index: number, words: Words, lines: Lines) => string = () => '';
export const zoneName: (at: Date, zone?: string) => string = () => '';
export const updatedLine: (readAt: string, words: Words, locale: string, zone?: string) => string = () => '';
export const isNewer: (shown: { version: number }, next: { version: number }) => boolean = () => true;
export const reconnectDelay: (attempt: number) => number = () => 0;
