/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-green-meter`.
 * @module @deepseek-ai/dsh-green-meter/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-green-meter';
/** Cordis companion plugin name. */
export const name = 'green-meter-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the ledger is a process-local sidecar written
 * append-only with schema-tagged rows, and malformed lines are skipped at
 * read time. Estimation math is covered by package tests.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map