import type {
  AvatarState,
  ClientMsg,
  Cosmetics,
  ServerMsg,
  ThrowLaunch,
} from "../shared/messages";
import { BackendEmitter, type Backend, type BackendEvents } from "./types";

// Live multiplayer: the same Backend surface as LocalBackend, spoken over
// a WebSocket to the game server. Intents go up; the server's events come
// down. The client's live ball is COSMETIC here — reportOutcome is a
// no-op, the server resolves every throw and its outcome arrives as an
// event.

export type SocketIdentity = Cosmetics & { id: string };

export class SocketBackend implements Backend {
  private readonly emitter = new BackendEmitter();
  private ws: WebSocket | null = null;
  /** the admin kicked this lobby — the close that follows is expected */
  private removed = false;

  constructor(
    private readonly opts: {
      url: string;
      lobby: string;
      identity: SocketIdentity;
      /** ?reset link: ask the server to wipe the shared score on join */
      reset?: boolean;
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
        reset: this.opts.reset,
      });
    ws.onmessage = (ev) => {
      try {
        this.dispatch(JSON.parse(String(ev.data)) as ServerMsg);
      } catch (err) {
        console.error("bad server message, skipped:", err);
      }
    };
    ws.onclose = () => {
      if (!this.removed) this.emitter.emit("disconnected", {});
    };
  }

  private dispatch(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.emitter.emit("welcome", {
          selfId: m.selfId,
          players: m.players,
          world: m.world,
          orb: m.orb,
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
      case "pose":
        this.emitter.emit("playerPosed", { id: m.id, s: m.s });
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
      case "upgraded":
        this.emitter.emit("upgraded", {
          tierId: m.tierId,
          world: m.world,
          byId: m.byId,
          byName: m.byName,
          placements: m.placements,
        });
        break;
      case "jukebox":
        this.emitter.emit("jukebox", { state: m.state, byName: m.byName });
        break;
      case "budget":
        this.emitter.emit("budget", { throwsRemaining: m.throwsRemaining });
        break;
      case "world-reset":
        this.emitter.emit("worldReset", { name: m.name, world: m.world });
        break;
      case "lobby-removed":
        this.removed = true;
        this.emitter.emit("lobbyRemoved", {});
        break;
      case "orb-spawned":
        this.emitter.emit("orbSpawned", { orb: m.orb });
        break;
      case "orb-removed":
        this.emitter.emit("orbRemoved", { seq: m.seq, byId: m.byId });
        break;
      case "teleported":
        this.emitter.emit("teleported", {
          id: m.id,
          throwId: m.throwId,
          x: m.x,
          d: m.d,
          h: m.h,
        });
        break;
      case "snapshot":
        this.emitter.emit("snapshot", {
          players: m.players,
          world: m.world,
          orb: m.orb,
        });
        break;
    }
  }

  moveTo(x: number, d: number): void {
    this.send({ t: "move-to", x, d });
  }

  sendPose(s: AvatarState): void {
    this.send({ t: "pose", s });
  }

  upgrade(): void {
    this.send({ t: "upgrade" });
  }

  jukeboxPress(): void {
    this.send({ t: "jukebox" });
  }

  jukeboxOffPress(): void {
    this.send({ t: "jukebox-off" });
  }

  requestThrow(throwId: string, launch: ThrowLaunch): void {
    this.send({ t: "throw", throwId, launch });
    // optimistic: spawn our ball NOW (zero-latency feel, exactly like the
    // prototype) — the server relays the throw to everyone else and owns
    // the outcome. If it rejects (budget/invalid), the flight was cosmetic
    // and a throw-rejected notice follows; no score can come from it.
    this.emitter.emit("throwStarted", {
      id: this.opts.identity.id,
      throwId,
      launch,
    });
  }

  /** The server is the authority — the local ball's opinion is cosmetic. */
  reportOutcome(): void {
    /* intentionally ignored */
  }

  /** Same for orb hits: the server simulates the arc and rules. */
  reportOrbHit(): void {
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
