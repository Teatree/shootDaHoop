import { T } from "./tuning";
import type { Player } from "./player";
import type { HUD } from "./hud";

// Chat slash-commands (owner ask 2026-07-18): text starting with "/"
// typed into the chat box runs an ACTION instead of sending a message.
// Commands execute LOCALLY - anything the court should see rides the
// systems that already broadcast (the /dance is a pose, so the pose
// telemetry carries it to every screen and into ghost recordings, no
// new wire format needed). Add new commands to REGISTRY; unknown ones
// answer with the list.

export interface CommandCtx {
  player: Player;
  hud: HUD;
}

interface ChatCommand {
  name: string;
  /** the one-line help shown for unknown commands */
  hint: string;
  run(ctx: CommandCtx, args: string[]): void;
}

const REGISTRY: ChatCommand[] = [
  {
    name: "dance",
    hint: "bust out the 67 dance",
    run(ctx) {
      ctx.player.dance(T.commands.danceDurationS);
      ctx.hud.log("presence", "You bust out the 67 dance! 6️⃣7️⃣");
    },
  },
];

/** Handle a chat-box submission. True = it was a command (or an attempt
 *  at one) - never send it to the court as a message. */
export function runChatCommand(text: string, ctx: CommandCtx): boolean {
  if (!text.startsWith("/")) return false;
  const [name = "", ...args] = text.slice(1).trim().split(/\s+/);
  const cmd = REGISTRY.find((c) => c.name === name.toLowerCase());
  if (cmd) {
    cmd.run(ctx, args);
  } else {
    ctx.hud.log(
      "presence",
      `Unknown command /${name}. Commands: ${REGISTRY.map(
        (c) => `/${c.name} (${c.hint})`,
      ).join(", ")}`,
    );
  }
  return true;
}
