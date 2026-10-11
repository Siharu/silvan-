// Player spawn point - ONE place that decides it, so terrain chunk centring,
// the ocean ring, the splat trail network, the shore props and the dog all
// agree.
//
// Why this exists (B-34): the spawn used to be a hard-coded (200, 0), picked
// when WORLD_SIZE was 800 and (200, 0) really was lowland. At WORLD_SIZE 3200
// the island is 4x wider but its height profile is the same, so (200, 0) is
// now on the volcano massif at elevation ~65 (grass stops at 36, water is at
// 1.6): a bare rocky slope, nothing like the "wake up on the shore" opening in
// THE_HEARTH_ENTIRE_STORY_AND_SETTINGS_PLAN.md. It was misread for a while as
// the grass shore-fade rule; the actual numbers are in SILVAN_BETA2_AUDIT.txt.
//
// The spawn is derived from the Ruined Cabin (the Act I destination) rather
// than hard-coded again: walk outward from the cabin, away from the island
// centre, to the last point that is still dry land ~1 unit above the
// waterline, i.e. the beach below the cabin, and face back inland toward it.
// Uses elevation-core's analytic getElevation (pure math, available before the
// heightmap bake finishes), so it can run at the very start of init().
import { getElevation } from './elevation-core.js';
import { WATER_LEVEL } from './state.js';

const BEACH_ABOVE_WATER = 1.0;   // spawn this far above the waterline: dry, but a storm surge (+3.5) still reaches it
const spawn = { x: 200, z: 0, yaw: 0 };   // fallback only if initSpawn() is never called; see above for why this is wrong at 3200

export function getSpawn() { return spawn; }

export function initSpawn(cabinX, cabinZ) {
    const len = Math.hypot(cabinX, cabinZ);
    if (len < 1) return spawn;
    const ux = cabinX / len, uz = cabinZ / len;
    const target = WATER_LEVEL + BEACH_ABOVE_WATER;

    let r = len;
    if (getElevation(ux * r, uz * r) >= target) {
        // cabin is on dry land: walk seaward to the last point still above target
        while (r < len + 800 && getElevation(ux * (r + 1), uz * (r + 1)) >= target) r += 1;
    } else {
        // cabin pad is already at/below target: walk inland until we're back on the beach
        while (r > 0 && getElevation(ux * r, uz * r) < target) r -= 1;
    }
    spawn.x = ux * r;
    spawn.z = uz * r;
    // yaw convention used by tutorial.js / player-controller.js: forward = (-sin yaw, -cos yaw)
    spawn.yaw = Math.atan2(-(cabinX - spawn.x), -(cabinZ - spawn.z));
    return spawn;
}
