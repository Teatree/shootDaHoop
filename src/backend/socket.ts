import type { ClientMsg, ServerMsg, ThrowLaunch } from "../shared/messages";
import { BackendEmitter, type Backend, type BackendEvents } from "./types";

// Live multiplayer: the same Backend surface as LocalBackend, spoken over
// a WebSocket to the game server. Intents go up; the server's events come
// down. The client's live ball is COSMETIC here — reportOutcome is a
// no-op, the server resolves every throw and its outcome arrives as an
// event.

export interface SocketIdentity {
  id: string;
  name: string;
  shirtColor: number;
}

export class SocketBackend implements Backend {
  private readonly emitter = new BackendEmitter();
  private ws: WebSocket | null = null;

  constructor(
    private readonly opts: {
      url: string;
      lobby: string;
      identity: SocketIdentity;
    },
  ) {}

  connect(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () =>
      this.send({
        t: "join",
        lobby: this.opts.lobby,
        identity: this.opts.identity,
      });
    ws.onmessage = (ev) => {
      try {
        this.dispatch(JSON.parse(String(ev.data)) as ServerMsg);
      } catch (err) {
        console.error("bad server message, skipped:", err);
      }
    };
    ws.onclose = () => this.emitter.emit("disconnected", {});
  }

  private dispatch(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.emitter.emit("welcome", {
          selfId: m.selfId,
          players: m.players,
          world: m.world,
          throwsRemaining: m.throwsRemaining,
          history: m.history,
        });
        break;
      case "join-rejected":
        this.emitter.emit("joinRejected", { reason: m.reason });
        break;
      case "player-joined":
        this.emitter.emit("playerJoined", { player: m.player });
        break;
      case "player-left":
        this.emitter.emit("playerLeft", { id: m.id, name: m.name });
        break;
      case "move-to":
        this.emitter.emit("playerMoved", { id: m.id, x: m.x, d: m.d });
        break;
      case "throw":
        this.emitter.emit("throwStarted", {
          id: m.id,
          throwId: m.throwId,
          launch: m.launch,
        });
        break;
      case "outcome":
        this.emitter.emit("outcome", m.outcome);
        break;
      case "throw-rejected":
        this.emitter.emit("throwRejected", {
          throwId: m.throwId,
          reason: m.reason,
        });
        break;
      case "chat":
        this.emitter.emit("chatMessage", {
          id: m.id,
          name: m.name,
          text: m.text,
        });
        break;
      case "tier-unlock":
        this.emitter.emit("tierUnlocked", { tierId: m.tierId, world: m.world });
        break;
      case "budget":
        this.emitter.emit("budget", { throwsRemaining: m.throwsRemaining });
        break;
      case "snapshot":
        this.emitter.emit("snapshot", { players: m.players, world: m.world });
        break;
    }
  }

  moveTo(x: number, d: number): void {
    this.send({ t: "move-to", x, d });
  }

  requestThrow(throwId: string, launch: ThrowLaunch): void {
    this.send({ t: "throw", throwId, launch });
  }

  /** The server is the authority — the local ball's opinion is cosmetic. */
  reportOutcome(): void {
    /* intentionally ignored */
  }

  chat(text: string): void {
    this.send({ t: "chat", text });
  }

  private send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(msg));
  }

  on<K extends keyof BackendEvents>(event: K, fn: BackendEvents[K]): void {
    this.emitter.on(event, fn);
  }

  dispose(): void {
    this.ws?.close();
    this.emitter.clear();
  }
}
