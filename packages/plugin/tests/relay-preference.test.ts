import { describe, expect, it } from 'vitest'
import { advertisedTransportCapabilities } from '../src/server-connection.js'
import {
  isForceRelayEnabled,
  setForceRelayEnabled,
  transportAttempts,
} from '../src/relay-preference.js'

describe('force relay', () => {
  it('collapses the attempt list to relay', () => {
    expect(transportAttempts(true, true)).toEqual(['relay'])
    expect(transportAttempts(false, true)).toEqual(['direct', 'turn', 'relay'])
    // No WebRTC backend on this Host: relay is the only option anyway.
    expect(transportAttempts(false, false)).toEqual(['relay'])
  })

  it('advertises relay-only capabilities to the Server', () => {
    expect(advertisedTransportCapabilities(true, true)).toEqual(['transport.relay', 'transport.relay.attach'])
    expect(advertisedTransportCapabilities(false, false)).toEqual(['transport.relay', 'transport.relay.attach'])
    expect(advertisedTransportCapabilities(false, true)).toEqual([
      'transport.lan',
      'transport.p2p',
      'transport.turn',
      'transport.relay',
      'transport.relay.attach',
    ])
  })

  it('flips the process-wide preference', () => {
    const original = isForceRelayEnabled()
    try {
      setForceRelayEnabled(true)
      expect(isForceRelayEnabled()).toBe(true)
      setForceRelayEnabled(false)
      expect(isForceRelayEnabled()).toBe(false)
    } finally {
      setForceRelayEnabled(original)
    }
  })
})
