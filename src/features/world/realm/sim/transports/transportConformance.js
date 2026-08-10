/**
 * transportConformance — the behavioural contract, written once.
 *
 * PURE. Imports nothing from vitest: each case is `{ name, run(expect) }`, and
 * the caller's own `.test.js` decides how to register them. A shared spec that
 * imported the test framework would be a test-framework dependency sitting in
 * `sim/`, reachable from application code.
 *
 * ─── Why this file exists at all ─────────────────────────────────────────────
 * WorldTransport.js has claimed since P1 that "the conformance suite runs
 * against both" implementations. It did not exist — the sentence described an
 * intention. That was harmless while there was exactly one transport; P8 adds
 * two more (a latency shaper and a scripted playback arm), and P12 adds the
 * SpacetimeDB one. The moment a behaviour is asserted for only one arm, offline
 * play and online play start to drift, and the drift surfaces as "works in dev,
 * broken in production" — the precise failure the header warned about.
 *
 * ─── The `settle` hook ───────────────────────────────────────────────────────
 * A transport is allowed to deliver events later than the call that caused
 * them; that is the entire point of the latency shaper. So every case that
 * observes an event calls `settle()` first, and each implementation supplies
 * whatever "let delivery finish" means for it — a no-op for the synchronous
 * in-process transport, pumping a virtual clock for the shaper. Without this
 * hook the suite would silently encode "delivery is synchronous" as part of the
 * contract and no delaying transport could ever conform.
 */

import { EVENT, REJECT, TRANSPORT_METHODS, isAck, isNack } from '../WorldTransport.js';

/** Collect events into an array, returning the array and the unsubscribe. */
function record(transport) {
  const seen = [];
  const off = transport.subscribe((kind, payload) => seen.push({ kind, payload }));
  return { seen, off };
}

/**
 * @param {() => ({
 *   transport: object,
 *   identity?: string,
 *   settle?: () => (void|Promise<void>),
 *   okCommand?: {name: string, payload: object}|null,
 * })} setup  Fresh, unconnected transport per case — cases must not share state.
 * @returns {{name: string, run: (expect: Function) => Promise<void>}[]}
 */
export function transportConformanceCases(setup) {
  const open = async () => {
    const s = setup();
    return {
      identity: 'conformance-player',
      settle: async () => {},
      okCommand: null,
      ...s,
    };
  };

  const cases = [
    {
      name: 'exposes every method the interface names',
      async run(expect) {
        const { transport } = await open();
        for (const m of TRANSPORT_METHODS) {
          expect(typeof transport[m], `missing ${m}()`).toBe('function');
        }
      },
    },
    {
      name: 'is not connected before connect()',
      async run(expect) {
        const { transport } = await open();
        expect(transport.isConnected()).toBe(false);
      },
    },
    {
      name: 'is connected after connect() and announces it',
      async run(expect) {
        const { transport, identity, settle } = await open();
        const { seen } = record(transport);
        await transport.connect(identity);
        await settle();

        expect(transport.isConnected()).toBe(true);
        const connection = seen.find((e) => e.kind === EVENT.CONNECTION);
        expect(connection, 'no CONNECTION event was emitted').toBeTruthy();
        expect(connection.payload.connected).toBe(true);
      },
    },
    {
      name: 'refuses commands before connect() instead of throwing',
      async run(expect) {
        // A refusal is a value. Throwing here would mean every caller needs a
        // try/catch around ordinary gameplay, and dispatch treats a throw as a
        // plumbing bug rather than a rejection.
        const { transport } = await open();
        const r = await transport.send('moveIntent', { x: 1, z: 1 }, 1);
        expect(isNack(r)).toBe(true);
        expect(r.code).toBe(REJECT.NOT_CONNECTED);
      },
    },
    {
      name: 'nacks an unknown command with the right code',
      async run(expect) {
        const { transport, identity } = await open();
        await transport.connect(identity);
        const r = await transport.send('no_such_command_exists', {}, 7);
        expect(isNack(r)).toBe(true);
        expect(r.code).toBe(REJECT.UNKNOWN_COMMAND);
      },
    },
    {
      name: 'echoes the seq it was given on every answer',
      async run(expect) {
        // Reconciliation anchors on this. An ack that invented its own seq
        // would leave the client unable to retire the matching prediction.
        const { transport, identity } = await open();
        await transport.connect(identity);
        const r = await transport.send('no_such_command_exists', {}, 4242);
        expect(r.seq).toBe(4242);
      },
    },
    {
      name: 'stops delivering after unsubscribe',
      async run(expect) {
        const { transport, identity, settle } = await open();
        const { seen, off } = record(transport);
        off();
        await transport.connect(identity);
        await settle();
        expect(seen).toEqual([]);
      },
    },
    {
      name: 'one throwing subscriber does not starve the others',
      async run(expect) {
        // Subscribers are third-party code. One bad handler must not stop the
        // world from being told what happened.
        const { transport, identity, settle } = await open();
        const seen = [];
        transport.subscribe(() => { throw new Error('subscriber blew up'); });
        transport.subscribe((kind) => seen.push(kind));
        await transport.connect(identity);
        await settle();
        expect(seen.length).toBeGreaterThan(0);
      },
    },
    {
      name: 'reports disconnection both ways',
      async run(expect) {
        const { transport, identity, settle } = await open();
        await transport.connect(identity);
        await settle();
        const { seen } = record(transport);
        await transport.disconnect();
        await settle();

        expect(transport.isConnected()).toBe(false);
        const bye = seen.find(
          (e) => e.kind === EVENT.CONNECTION && e.payload.connected === false,
        );
        expect(bye, 'no CONNECTION{connected:false} event').toBeTruthy();
      },
    },
    {
      name: 'refuses commands again after disconnect',
      async run(expect) {
        const { transport, identity } = await open();
        await transport.connect(identity);
        await transport.disconnect();
        const r = await transport.send('moveIntent', { x: 1, z: 1 }, 9);
        expect(isNack(r)).toBe(true);
        expect(r.code).toBe(REJECT.NOT_CONNECTED);
      },
    },
  ];

  // Only meaningful for a transport that actually has a command to accept.
  // Skipping is honest: a playback arm has no gameplay surface to exercise.
  cases.push({
    name: 'acks a valid command and echoes its seq',
    async run(expect) {
      const { transport, identity, okCommand } = await open();
      if (!okCommand) return;
      await transport.connect(identity);
      const r = await transport.send(okCommand.name, okCommand.payload, 11);
      expect(isAck(r), `expected an ack, got ${JSON.stringify(r)}`).toBe(true);
      expect(r.seq).toBe(11);
    },
  });

  return cases;
}
