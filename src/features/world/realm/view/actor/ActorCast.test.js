/**
 * ActorCast.test.js — the dev spike's actor roster, as RUNTIME FACTS.
 *
 * ActorRig.test.js already proves the mesh-level contracts (one mesh per
 * actor, live world matrices, ground seating, LOD swaps, shadow handoff) in
 * depth; this file does not re-derive them. What it covers is the thing only
 * ActorCast can be wrong about: does it actually assemble the roster spike.js
 * needs — a player plus two demo actors of distinct archetypes, all three
 * registered with the shadow rig — and does its own update() correctly
 * route the walker into the player while leaving the static demo actors
 * where they stand.
 *
 * The headline gate, as in ActorRig.test.js, is behavioural rather than a
 * flag check: move the walker and read the player's absolutePosition back,
 * because a wiring mistake that drops the seatOn/setYaw calls looks
 * perfectly correct to every structural assertion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import BABYLON from 'babylonjs';
import { ARCHETYPES } from '../../model/actorMasses.js';
import { PROP_TIER, TIER_BANDS_M } from '../../model/propLod.js';

let ActorCast;
let ActorShadowRig;
let createTerrainField;
let engine;

beforeAll(async () => {
  globalThis.BABYLON = BABYLON;
  ({ ActorCast } = await import('./ActorCast.js'));
  ({ ActorShadowRig } = await import('../lighting/ActorShadowRig.js'));
  ({ createTerrainField } = await import('../../model/terrainField.js'));
  engine = new BABYLON.NullEngine();
});

afterAll(() => { engine?.dispose(); });

function newWorld() {
  const scene = new BABYLON.Scene(engine);
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, 0.3), scene);
  const material = new BABYLON.StandardMaterial('actorCastStandIn', scene);
  const field = createTerrainField();
  const shadowRig = new ActorShadowRig(scene, sun);
  return { scene, sun, material, field, shadowRig };
}

/** One flattened 4x4 identity, repeated per bone slot by getTransformMatrices(). */
const IDENTITY_16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Is this skeleton's LIVE palette bit-exact identity? Runtime fact, not a
 * flag check — a rig that was never posed, or one whose pose was silently
 * dropped, reads identically to this either way, which is exactly the
 * distinction ActorSkeleton.test.js's own `identityMismatches` exists to
 * make (that helper is local to that file; this is the same check, inlined).
 */
function paletteIsIdentity(skeleton) {
  const palette = skeleton.getTransformMatrices(null);
  for (let i = 0; i < palette.length; i++) {
    if (!Object.is(palette[i], IDENTITY_16[i % 16])) return false;
  }
  return true;
}

describe('ActorCast — construction', () => {
  it('builds the player plus two static demo actors', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      expect(cast.player).toBeTruthy();
      expect(cast.player.mesh).toBeTruthy();
      expect(cast.demoActors).toHaveLength(2);
      for (const rig of cast.demoActors) expect(rig.mesh).toBeTruthy();
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the player and both demo actors are of three DISTINCT archetypes', () => {
    // The live demonstration the deleted sentinelAt comment asked for needs
    // real variety, not the same archetype cloned three times.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const ids = [cast.player.archetypeId, ...cast.demoActors.map((a) => a.archetypeId)];
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(ARCHETYPES.some((a) => a.id === id)).toBe(true);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('registers all three actors as shadow casters, and no more', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      expect(shadowRig._casters.has(cast.player.mesh)).toBe(true);
      for (const rig of cast.demoActors) expect(shadowRig._casters.has(rig.mesh)).toBe(true);
      expect(shadowRig._casters.size).toBe(3);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('works with no shadow rig at all', () => {
    const { scene, material, field } = newWorld();
    try {
      expect(() => new ActorCast(scene, { material, field })).not.toThrow();
    } finally {
      scene.dispose();
    }
  });

  it('poses the legion demo actor at construction; the player and the orghon demo stay at rest', () => {
    // TASK 7's whole contribution, as a runtime fact rather than a flag: a
    // wiring mistake that drops the rig.setPose(CANARY_POSE.legion) call at
    // construction looks perfectly correct to every other assertion in this
    // file — the mesh still exists, the archetype is still 'legion', the
    // shadow registration still happens — and only the LIVE PALETTE reveals
    // whether the bones actually bent.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const [legion, orghon] = cast.demoActors;
      // Sanity on WHICH archetype is which, so a future reordering of
      // DEMO_ARCHETYPES fails loudly here rather than silently posing the
      // wrong actor and passing anyway.
      expect(legion.archetypeId).toBe('legion');
      expect(orghon.archetypeId).toBe('orghon');

      expect(
        paletteIsIdentity(legion.skeleton),
        'the legion demo actor`s palette is bit-exact identity — is ActorCast still '
        + 'calling rig.setPose(CANARY_POSE.legion) at construction?',
      ).toBe(false);
      expect(paletteIsIdentity(cast.player.skeleton), 'the player must stay at rest').toBe(true);
      expect(paletteIsIdentity(orghon.skeleton), 'the orghon demo actor must stay at rest').toBe(true);

      // The console-verification surface Task 8 reaches for.
      expect(cast.posedDemo).toBe(legion);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorCast — per-frame update', () => {
  it('moves and turns the player rig to the walker`s state', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const focus = { x: 0, y: 0, z: 0 };

      cast.update({ x: 5, y: 1.2, z: -3, yaw: 0.4 }, focus);
      cast.player.root.computeWorldMatrix(true);
      const first = cast.player.root.absolutePosition.clone();
      expect(first.x).toBeCloseTo(5, 6);
      expect(first.y).toBeCloseTo(1.2, 6);
      expect(first.z).toBeCloseTo(-3, 6);
      expect(cast.player.root.rotation.y).toBeCloseTo(0.4, 6);

      cast.update({ x: 40, y: 2, z: 12, yaw: 1.1 }, focus);
      cast.player.root.computeWorldMatrix(true);
      const second = cast.player.root.absolutePosition;
      expect(
        second.equals(first),
        'the player did not move on the second update() — is seatOn still being called?',
      ).toBe(false);
      expect(second.x).toBeCloseTo(40, 6);
      expect(second.z).toBeCloseTo(12, 6);
      expect(cast.player.root.rotation.y).toBeCloseTo(1.1, 6);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('leaves the demo actors` own position untouched, but still re-tiers them against a moving focus', () => {
    // BOTH halves of this title are asserted, which they were not until the
    // P6 final review: the body used to check only `absolutePosition`, which
    // is unchanged whether or not update() is ever forwarded to the rigs. The
    // whole LOD-tiering half of ActorCast.update() was deletable with the
    // realm suite green — including this test, the one named for it. `tier`
    // and `swapCount` are the two observable consequences of the forwarding,
    // so they are what gets read.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const [demo] = cast.demoActors;
      demo.root.computeWorldMatrix(true);
      const before = demo.root.absolutePosition.clone();
      // ActorRig's constructor default; the cast passes no tier.
      expect(demo.tier, 'a fresh rig starts NEAR').toBe(PROP_TIER.NEAR);
      expect(demo.swapCount).toBe(0);

      // Focus far from every demo actor: this must not move demo's OWN seat,
      // and must step it down to MID.
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: -5000, y: 0, z: 5000 });
      demo.root.computeWorldMatrix(true);
      expect(demo.root.absolutePosition.equals(before)).toBe(true);
      expect(
        demo.tier,
        'the demo actor never left NEAR against a focus 5 km away — is update() still forwarded to the rigs?',
      ).toBe(PROP_TIER.MID);
      expect(demo.swapCount, 'a tier change must rebuild the mesh exactly once').toBe(1);

      // ...and back, when the focus walks onto it. This is the round trip the
      // header sells as the phase's live demonstration.
      const seat = demo.root.absolutePosition;
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: seat.x, y: seat.y, z: seat.z });
      demo.root.computeWorldMatrix(true);
      expect(demo.root.absolutePosition.equals(before), 'the round trip must not move its seat').toBe(true);
      expect(demo.tier, 'walking the focus onto the demo actor must step it back to NEAR').toBe(PROP_TIER.NEAR);
      expect(demo.swapCount).toBe(2);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('re-tiers the PLAYER against the focus too, not just the demo actors', () => {
    // The player's own update() call is a separate line from the demo loop and
    // was separately deletable with the suite green. It is close to inert in
    // the spike (camera.target eases toward the walker, so the distance is
    // ~0 and the player resolves NEAR essentially always) — which is exactly
    // why nothing would have noticed it going missing.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const walker = { x: 0, y: 0, z: 0, yaw: 0 };
      const far = TIER_BANDS_M.nearMaxM * 10;

      cast.update(walker, { x: 0, y: 0, z: 0 });
      expect(cast.player.tier).toBe(PROP_TIER.NEAR);
      expect(cast.player.swapCount).toBe(0);

      cast.update(walker, { x: far, y: 0, z: 0 });
      expect(
        cast.player.tier,
        `the player stayed NEAR with the focus ${far} m away — is this.player.update(focusPos) still called?`,
      ).toBe(PROP_TIER.MID);
      expect(cast.player.swapCount).toBe(1);

      cast.update(walker, { x: 0, y: 0, z: 0 });
      expect(cast.player.tier).toBe(PROP_TIER.NEAR);
      expect(cast.player.swapCount).toBe(2);

      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a disposed cast`s update() is a no-op, not a throw', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.dispose();
      expect(() => cast.update({ x: 1, y: 1, z: 1, yaw: 1 }, { x: 0, y: 0, z: 0 })).not.toThrow();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorCast — remote roster (P8b)', () => {
  const sample = (id, epoch, x = 10, z = 10, yaw = 0.5) => ({ id, epoch, x, z, yaw });

  it('spawns a rig per sample and seats it on the terrain at the sampled (x, z)', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.syncRemotes([sample('g1', 1, 30, -12, 1.2)]);

      expect(cast.remotes.size).toBe(1);
      const rig = cast.remotes.get('g1#1');
      rig.root.computeWorldMatrix(true);
      const p = rig.root.absolutePosition;
      expect(p.x).toBeCloseTo(30, 6);
      expect(p.z).toBeCloseTo(-12, 6);
      // Y comes from the field, not the wire — the wire has no Y at all.
      expect(p.y).toBeCloseTo(field.surfaceY(30, -12), 6);
      expect(rig.root.rotation.y).toBeCloseTo(1.2, 6);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('reuses the same rig across frames for the same id#epoch', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.syncRemotes([sample('g1', 1, 0, 0)]);
      const first = cast.remotes.get('g1#1');
      cast.syncRemotes([sample('g1', 1, 5, 5)]);
      expect(cast.remotes.get('g1#1')).toBe(first);
      expect(cast.remotes.size).toBe(1);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('disposes a rig the moment its actor is absent — skeletons return to baseline', () => {
    // The leak gate. A Skeleton is scene-registered and outlives its nodes;
    // a roster that forgets rig.dispose() on despawn leaks one skeleton per
    // departed player, invisible everywhere except scene.skeletons.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const baseline = scene.skeletons.length; // player + demo actors
      cast.syncRemotes([sample('g1', 1), sample('g2', 1)]);
      expect(scene.skeletons.length).toBe(baseline + 2);

      cast.syncRemotes([sample('g2', 1)]);
      expect(
        scene.skeletons.length,
        'a departed remote`s skeleton outlived it — is syncRemotes calling rig.dispose()?',
      ).toBe(baseline + 1);
      expect(cast.remotes.has('g1#1')).toBe(false);

      cast.syncRemotes([]);
      expect(scene.skeletons.length).toBe(baseline);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('a respawned id (new epoch) gets a NEW rig, never the old one', () => {
    // The view-side twin of the hub's ingestion gate: keying by id#epoch makes
    // stale-rig reuse structurally impossible, rather than relying on anyone
    // remembering to reset per-rig state between occupants.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.syncRemotes([sample('g1', 1)]);
      const first = cast.remotes.get('g1#1');
      const firstMesh = first.mesh;

      cast.syncRemotes([sample('g1', 2)]);
      expect(cast.remotes.has('g1#1')).toBe(false);
      expect(cast.remotes.get('g1#2')).not.toBe(first);
      expect(firstMesh.isDisposed()).toBe(true);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('assigns every remote a real archetype, deterministically by id', () => {
    // Placeholder until P12 puts the class on the wire: any two clients (any
    // two CASTS) hashing the same id must land on the same archetype, or two
    // spectators of one world would see different actors.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const castA = new ActorCast(scene, { material, field, shadowRig });
      const castB = new ActorCast(scene, { material, field });
      const ids = ['ghost-0', 'ghost-1', 'ghost-2', 'pack:77'];
      castA.syncRemotes(ids.map((id) => sample(id, 1)));
      castB.syncRemotes(ids.map((id) => sample(id, 1)));
      for (const id of ids) {
        const a = castA.remotes.get(`${id}#1`);
        const b = castB.remotes.get(`${id}#1`);
        expect(ARCHETYPES.some((x) => x.id === a.archetypeId)).toBe(true);
        expect(a.archetypeId).toBe(b.archetypeId);
      }
      castA.dispose();
      castB.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('registers remotes as shadow casters and unregisters them on despawn', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const before = shadowRig._casters.size; // the fixed cast of three
      cast.syncRemotes([sample('g1', 1)]);
      expect(shadowRig._casters.size).toBe(before + 1);
      cast.syncRemotes([]);
      expect(shadowRig._casters.size).toBe(before);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('re-tiers remote rigs against the focus like every other actor', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.syncRemotes([sample('g1', 1, 0, 0)]);
      const rig = cast.remotes.get('g1#1');
      expect(rig.tier).toBe(PROP_TIER.NEAR);

      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: -5000, y: 0, z: 5000 });
      expect(
        rig.tier,
        'a remote rig never left NEAR against a focus 5 km away — is update() iterating remotes?',
      ).toBe(PROP_TIER.MID);
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('is a no-op after dispose', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.dispose();
      expect(() => cast.syncRemotes([sample('g1', 1)])).not.toThrow();
      expect(cast.remotes.size).toBe(0);
    } finally {
      scene.dispose();
    }
  });
});

describe('P8b guards', () => {
  it('setYaw throws loudly if anything has set rotationQuaternion on an actor root', () => {
    // Babylon semantics: the first non-null rotationQuaternion assignment
    // makes .rotation ignored in world-matrix composition permanently. Every
    // Euler yaw write becomes a silent no-op while every `.rotation.y`
    // assertion keeps passing — the property still stores, it just stops
    // being read. Same green-while-wrong class as P6's winding. The guard
    // turns it into a failure at the write site.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.player.setYaw(1.0); // fine while null
      cast.player.root.rotationQuaternion = BABYLON.Quaternion.Identity();
      expect(() => cast.player.setYaw(2.0)).toThrow(/rotationQuaternion/);
      cast.player.root.rotationQuaternion = null;
      expect(() => cast.player.setYaw(2.0)).not.toThrow();
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });

  it('the key light stays on auto-extend with actors as the sole shadow casters', () => {
    // Carry-forward #4's cheap gate, finally owned by a phase. The 0.40 m
    // envelope margin was sized for TWO consumers — frustum culling and the
    // directional light's auto-extended shadow ortho, whose cost is quadratic
    // in extent. Nothing failed if a light pinned shadowFrustumSize or a
    // non-actor caster joined the render list; P8 multiplies casters and
    // spreads them across latency-displaced positions, so now something does.
    const { scene, sun, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      cast.syncRemotes([{ id: 'g1', epoch: 1, x: 2, z: 2, yaw: 0 }]);
      // Classify everyone against a focus at the player: near actors join the
      // map. The bucketing pass is the shadow rig's own update — a separate
      // call in the frame loop, so a separate call here.
      cast.update({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: 0 });
      shadowRig.update({ x: 0, y: 0, z: 0 });

      expect(
        sun.shadowFrustumSize,
        'the key light has a pinned shadow frustum — the envelope margin was sized for auto-extend',
      ).toBe(0);
      expect(sun.autoUpdateExtends).not.toBe(false);

      const renderList = shadowRig._generator.getShadowMap().renderList;
      expect(renderList.length, 'no caster ever reached the shadow map').toBeGreaterThan(0);
      const actorMeshes = new Set([
        cast.player.mesh,
        ...cast.demoActors.map((r) => r.mesh),
        ...[...cast.remotes.values()].map((r) => r.mesh),
      ]);
      for (const mesh of renderList) {
        expect(
          actorMeshes.has(mesh),
          `non-actor caster "${mesh.name}" in the shadow render list — the quadratic ortho cost is unbudgeted for it`,
        ).toBe(true);
      }
      cast.dispose();
    } finally {
      scene.dispose();
    }
  });
});

describe('ActorCast — dispose', () => {
  it('releases every rig`s mesh, and clears the shadow registration', () => {
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const cast = new ActorCast(scene, { material, field, shadowRig });
      const meshes = [cast.player.mesh, ...cast.demoActors.map((a) => a.mesh)];
      expect(meshes).toHaveLength(3);

      cast.dispose();

      for (const mesh of meshes) expect(mesh.isDisposed()).toBe(true);
      expect(shadowRig._casters.size).toBe(0);
      expect(cast.demoActors).toHaveLength(0);
      expect(() => cast.dispose()).not.toThrow(); // idempotent
    } finally {
      scene.dispose();
    }
  });

  it('releases every rig`s skeleton too — scene.skeletons returns to baseline, posed or not', () => {
    // A Skeleton is scene-registered and is NOT a Node (ActorRig.js's header,
    // ActorRigSkin.test.js's own version of this test) — disposing the mesh
    // and the root leaves it behind. The posed legion demo actor is not a
    // special case for this: setPose() only ever writes bone matrices on an
    // existing Skeleton object, never adds a second one to the scene.
    const { scene, material, field, shadowRig } = newWorld();
    try {
      const baseline = scene.skeletons.length;
      const cast = new ActorCast(scene, { material, field, shadowRig });
      // player + 2 demo actors, one skeleton each — ActorRig.js's "ONE
      // skeleton per actor" commitment, read as a scene-level count.
      expect(scene.skeletons.length).toBe(baseline + 3);

      cast.dispose();

      expect(
        scene.skeletons.length,
        'a posed skeleton outlived its actor — dispose() must release it exactly like an unposed one',
      ).toBe(baseline);
    } finally {
      scene.dispose();
    }
  });
});
