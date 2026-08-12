/**
 * localWorld — one in-process world that several LocalTransports can share.
 *
 * PURE. A memoryDb plus a fan-out bus, and nothing else.
 *
 * ─── The problem this solves ─────────────────────────────────────────────────
 * Through P7, `createLocalTransport()` built its own private memoryDb and bound
 * one identity. Two of them were therefore two disjoint universes: each client
 * saw only itself, and no arrangement of them could produce a remote player to
 * look at. That was invisible for seven phases because nothing had ever asked
 * for a second occupant.
 *
 * Splitting the world out changes the unit of "a server" from the transport to
 * this object. A transport is now a CONNECTION to a world, which is what it
 * always was in the SpacetimeDB arm — so the demo's N-client setup and P12's
 * real multi-client shape are the same shape, rather than a local special case
 * that has to be unlearned later.
 *
 * ─── Why events fan out here and not through the db ──────────────────────────
 * Writing to a shared db does not tell anyone. The alternative — every client
 * polling the tables each frame — is how the old stack ended up diffing the
 * world on the render thread. A bus means a write reaches exactly the clients
 * attached to that world, once, at the moment it happens.
 */

import { createMemoryDb } from './memoryDb.js';

export const TABLES = Object.freeze(['player', 'mob']);

export function createLocalWorld() {
  const db = createMemoryDb(TABLES);
  /** One delivery function per attached transport. */
  const ports = new Set();

  return {
    db,

    /**
     * Register a transport's inbound delivery.
     * @returns {() => void} detach
     */
    attach(deliver) {
      ports.add(deliver);
      return () => ports.delete(deliver);
    },

    /**
     * Deliver to every attached transport. Iterates a copy: a handler may
     * detach itself (a disconnect cascading from an event) mid-fan-out, and
     * mutating a Set while iterating it silently skips entries.
     */
    broadcast(kind, payload) {
      for (const deliver of [...ports]) deliver(kind, payload);
    },

    /** Attached client count. Test and diagnostic surface. */
    portCount: () => ports.size,
  };
}
