// Better Auth's options name Bun's SQLite `Database` as one database it
// accepts (plan 4 Task 3, shyden-labs/ShyTalk#76). ShyTalk never runs on Bun,
// so `Database` is declared as `never`: a type that no value ever has.
declare module 'bun:sqlite' {
  export type Database = never;
}
