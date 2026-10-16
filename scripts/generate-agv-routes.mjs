#!/usr/bin/env node
/** Compatibility command. Geometry, AGV routes, quay/gantry assets are now
 * derived TOGETHER so a legacy yard-traversing route can never overwrite the
 * validated seaside handoff geometry independently.
 * Run from project root: npm run scenario:generate
 */
import './generate-port-layout.mjs';
