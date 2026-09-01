import { applySetup } from "./apply.ts";
import { defaultContext, isReady, probeSetup } from "./probe.ts";
import { printChecklist, printNextSteps } from "./print.ts";
import type { SetupContext } from "./types.ts";

export type SetupOptions = {
  checkOnly?: boolean;
  ctx?: SetupContext;
};

export function runSetup(opts: SetupOptions = {}): number {
  const ctx = opts.ctx ?? defaultContext();
  const initial = probeSetup(ctx);
  printChecklist(initial, ctx.log);

  if (opts.checkOnly) {
    return isReady(initial) ? 0 : 1;
  }

  if (isReady(initial)) {
    printNextSteps(ctx, initial);
    return 0;
  }

  ctx.log("");
  let outcome;
  try {
    outcome = applySetup(ctx, initial);
  } catch (err) {
    ctx.log(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (outcome.message) {
    ctx.log("");
    ctx.log(outcome.message);
  }
  if (outcome.reboot) {
    return 0;
  }
  if (outcome.failed) {
    return 1;
  }

  const after = probeSetup(ctx);
  if (outcome.repairs.length > 0) {
    ctx.log("");
    printChecklist(after, ctx.log);
  }
  if (!isReady(after)) {
    if (!outcome.message) {
      ctx.log("");
      ctx.log("Setup is not complete. Fix the items above and run `yarder setup` again.");
    }
    return 1;
  }
  printNextSteps(ctx, after);
  return 0;
}
