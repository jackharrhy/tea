import { STATE_RESEND_MS } from "./config";
import {
  applyStateDelta,
  clusterStateDeltas,
  createStateDelta,
} from "./network-codec";
import { cloneNetworkState, isNewerSequence16 } from "./network-state";
import type {
  NetworkObjectState,
  RuntimeId,
  StateAckPacket,
  StateClusterPacket,
} from "./types";

type SentState = {
  state: NetworkObjectState;
  sentAtMs: number;
};

export class StateReplicationPeer {
  readonly #acked = new Map<string, NetworkObjectState>();
  readonly #sent = new Map<string, Map<number, SentState>>();
  readonly #lastSent = new Map<string, SentState>();
  #clusterSequence = 0;

  seedReliable(states: readonly NetworkObjectState[]): void {
    for (const state of states) {
      const key = idKey(state.id);
      this.#acked.set(key, cloneNetworkState(state));
      this.#sent.delete(key);
      this.#lastSent.delete(key);
    }
  }

  remove(id: RuntimeId): void {
    const key = idKey(id);
    this.#acked.delete(key);
    this.#sent.delete(key);
    this.#lastSent.delete(key);
  }

  acknowledge(packet: StateAckPacket): void {
    for (const entry of packet.entries) {
      const key = idKey(entry.id);
      const sent = this.#sent.get(key)?.get(entry.stateSequence);
      if (
        !sent ||
        sent.state.authorityVersion !== entry.authorityVersion ||
        !sameId(sent.state.id, entry.id)
      ) {
        continue;
      }
      const existing = this.#acked.get(key);
      if (
        existing &&
        existing.authorityVersion === sent.state.authorityVersion &&
        !isNewerSequence16(sent.state.stateSequence, existing.stateSequence) &&
        sent.state.stateSequence !== existing.stateSequence
      ) {
        continue;
      }
      this.#acked.set(key, cloneNetworkState(sent.state));
      const history = this.#sent.get(key);
      if (history) {
        for (const [sequence, candidate] of history) {
          if (
            candidate.state.authorityVersion !== sent.state.authorityVersion ||
            sequence === sent.state.stateSequence ||
            !isNewerSequence16(sequence, sent.state.stateSequence)
          ) {
            history.delete(sequence);
          }
        }
        if (history.size === 0) this.#sent.delete(key);
      }
    }
  }

  createClusters(
    worldEpoch: number,
    states: readonly NetworkObjectState[],
    nowMs: number,
  ): StateClusterPacket[] {
    const deltas = states.flatMap((state) => {
      const key = idKey(state.id);
      const baseline = this.#acked.get(key) ?? null;
      if (
        baseline &&
        baseline.authorityVersion === state.authorityVersion &&
        baseline.stateSequence === state.stateSequence
      ) {
        return [];
      }
      const last = this.#lastSent.get(key);
      if (
        last &&
        last.state.authorityVersion === state.authorityVersion &&
        last.state.stateSequence === state.stateSequence &&
        nowMs - last.sentAtMs < STATE_RESEND_MS
      ) {
        return [];
      }
      const cloned = cloneNetworkState(state);
      const sent = { state: cloned, sentAtMs: nowMs };
      this.#lastSent.set(key, sent);
      const history = this.#sent.get(key) ?? new Map<number, SentState>();
      history.set(state.stateSequence, sent);
      while (history.size > 64) history.delete(history.keys().next().value!);
      this.#sent.set(key, history);
      return [createStateDelta(state, baseline)];
    });
    const clustered = clusterStateDeltas(
      worldEpoch,
      this.#clusterSequence,
      deltas,
    );
    this.#clusterSequence = clustered.nextClusterSequence;
    return clustered.clusters;
  }
}

export class StateReceiver {
  readonly #states = new Map<string, NetworkObjectState>();
  readonly #history = new Map<string, Map<number, NetworkObjectState>>();

  reset(states: readonly NetworkObjectState[]): void {
    this.#states.clear();
    this.#history.clear();
    for (const state of states) this.#replaceHistory(state);
  }

  replaceReliable(state: NetworkObjectState): boolean {
    const key = idKey(state.id);
    const current = this.#states.get(key);
    if (
      current &&
      (state.authorityVersion < current.authorityVersion ||
        (state.authorityVersion === current.authorityVersion &&
          state.stateSequence !== current.stateSequence &&
          !isNewerSequence16(state.stateSequence, current.stateSequence)))
    )
      return false;
    this.#replaceHistory(state);
    return true;
  }

  remove(id: RuntimeId): void {
    const key = idKey(id);
    this.#states.delete(key);
    this.#history.delete(key);
  }

  state(id: RuntimeId): NetworkObjectState | null {
    const state = this.#states.get(idKey(id));
    return state ? cloneNetworkState(state) : null;
  }

  states(): NetworkObjectState[] {
    return [...this.#states.values()].map(cloneNetworkState);
  }

  applyCluster(packet: StateClusterPacket): {
    accepted: NetworkObjectState[];
    ack: StateAckPacket;
  } {
    const accepted: NetworkObjectState[] = [];
    const entries: StateAckPacket["entries"] = [];
    for (const delta of packet.states) {
      const key = idKey(delta.id);
      const current = this.#states.get(key) ?? null;
      if (current && delta.authorityVersion < current.authorityVersion)
        continue;
      if (
        current &&
        delta.authorityVersion === current.authorityVersion &&
        !isNewerSequence16(delta.stateSequence, current.stateSequence)
      ) {
        if (delta.stateSequence === current.stateSequence) {
          entries.push({
            id: { ...current.id },
            authorityVersion: current.authorityVersion,
            stateSequence: current.stateSequence,
          });
        }
        continue;
      }
      const baseline =
        delta.baselineSequence === null
          ? null
          : (this.#history.get(key)?.get(delta.baselineSequence) ?? null);
      let state: NetworkObjectState;
      try {
        state = applyStateDelta(baseline, delta);
      } catch {
        continue;
      }
      this.#states.set(key, state);
      const history =
        this.#history.get(key) ?? new Map<number, NetworkObjectState>();
      history.set(state.stateSequence, cloneNetworkState(state));
      while (history.size > 64) history.delete(history.keys().next().value!);
      this.#history.set(key, history);
      accepted.push(cloneNetworkState(state));
      entries.push({
        id: { ...state.id },
        authorityVersion: state.authorityVersion,
        stateSequence: state.stateSequence,
      });
    }
    return {
      accepted,
      ack: { worldEpoch: packet.worldEpoch, entries },
    };
  }

  #replaceHistory(state: NetworkObjectState): void {
    const key = idKey(state.id);
    const cloned = cloneNetworkState(state);
    this.#states.set(key, cloned);
    this.#history.set(
      key,
      new Map([[state.stateSequence, cloneNetworkState(state)]]),
    );
  }
}

export function idKey(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

function sameId(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}
