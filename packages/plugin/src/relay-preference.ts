/**
 * Relay preference ("force relay"): the data plane skips LAN, internet-direct
 * (P2P) and TURN probing and goes straight to the encrypted relay.
 *
 * Why a runtime switch instead of reading the config every time: the Host
 * advertises its transport capabilities when it dials the Server, and the
 * Client walks its attempt list per connection. Both read this process-wide
 * flag so a toggle applies without rebuilding the plugin, mirroring
 * {@link ./lite-mode.ts}. Seeded from `config.forceRelay` at startup; the
 * config keeps working for users who set it statically.
 */

import type { TransportAttempt } from './client-runtime-contract.js'

let enabled = false

/** Whether the relay-only preference is currently on. */
export function isForceRelayEnabled(): boolean {
  return enabled
}

/** Flip the relay-only preference for subsequent connections. */
export function setForceRelayEnabled(next: boolean): void {
  enabled = next === true
}

/**
 * Attempts a Client walks when connecting. A Host without a usable WebRTC
 * backend can only relay, so both cases collapse to a single attempt.
 */
export function transportAttempts(forceRelay: boolean, rtcAvailable: boolean): TransportAttempt[] {
  return forceRelay || !rtcAvailable ? ['relay'] : ['direct', 'turn', 'relay']
}
