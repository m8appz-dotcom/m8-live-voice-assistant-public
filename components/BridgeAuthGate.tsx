import React from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'

export default function BridgeAuthGate({
  bridgeAuthenticated,
  bridgeChecking,
  passkeySupported,
  passkeyConfigured,
  passkeyBusy,
  bridgePassword,
  bridgeAuthBusy,
  bridgeAuthError,
  setBridgePassword,
  setBridgeAuthError,
  unlockBridge,
  unlockWithPasskey,
  enablePasskey
}: any) {
  if (bridgeAuthenticated && passkeySupported && !passkeyConfigured) {
    return (
      <View style={s.passkeyHintWrap}>
        <View style={s.passkeyHintCard}>
          <Text style={s.passkeyHintTitle}>Enable fingerprint or PIN</Text>
          <Text style={s.passkeyHintCopy}>Save a passkey on this device so next unlock can use Android biometrics or system PIN instead of the bridge password.</Text>
          <Pressable
            style={[s.authButton, passkeyBusy && { opacity: 0.6 }]}
            onPress={() => { if (!passkeyBusy) void enablePasskey() }}
            disabled={passkeyBusy}
          >
            <Text style={s.authButtonText}>{passkeyBusy ? 'Waiting for device confirmation...' : 'Enable passkey'}</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (!bridgeAuthenticated || bridgeChecking) {
    return (
      <View style={s.authOverlay}>
        <View style={s.authCard}>
          <Text style={s.authTitle}>Unlock bridge</Text>
          <Text style={s.authCopy}>
            You can unlock with a passkey, which uses your phone fingerprint or system PIN, or fall back to the bridge password.
          </Text>
          {passkeySupported && passkeyConfigured && (
            <Pressable
              style={[s.authButton, (bridgeChecking || passkeyBusy) && { opacity: 0.6 }]}
              onPress={() => { if (!bridgeChecking && !passkeyBusy) void unlockWithPasskey() }}
              disabled={bridgeChecking || passkeyBusy}
            >
              <Text style={s.authButtonText}>{bridgeChecking ? 'Checking...' : passkeyBusy ? 'Waiting for biometric...' : 'Use fingerprint or PIN'}</Text>
            </Pressable>
          )}
          <TextInput
            value={bridgePassword}
            onChangeText={(value) => { setBridgePassword(value); if (bridgeAuthError) setBridgeAuthError('') }}
            placeholder="Bridge password"
            placeholderTextColor="rgba(255,255,255,0.28)"
            secureTextEntry
            editable={!bridgeChecking && !bridgeAuthBusy && !passkeyBusy}
            style={s.authInput}
            onSubmitEditing={() => { if (!bridgeChecking && !bridgeAuthBusy && !passkeyBusy) void unlockBridge() }}
          />
          {!!bridgeAuthError && <Text style={s.authError}>{bridgeAuthError}</Text>}
          <Pressable
            style={[s.authButtonSecondary, (bridgeChecking || bridgeAuthBusy || passkeyBusy) && { opacity: 0.6 }]}
            onPress={() => { if (!bridgeChecking && !bridgeAuthBusy && !passkeyBusy) void unlockBridge() }}
            disabled={bridgeChecking || bridgeAuthBusy || passkeyBusy}
          >
            <Text style={s.authButtonSecondaryText}>{bridgeChecking ? 'Checking...' : bridgeAuthBusy ? 'Unlocking...' : 'Unlock with password'}</Text>
          </Pressable>
        </View>
      </View>
    )
  }
  return null
}

const s = StyleSheet.create({
  authOverlay: {
    position: 'absolute', inset: 0,
    zIndex: 120,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
  },
  authCard: {
    width: '100%', maxWidth: 420,
    backgroundColor: '#111111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 18,
    gap: 12,
  },
  authTitle: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  authCopy: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20 },
  authInput: {
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  authError: { color: '#f87171', fontSize: 13 },
  authButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#00ffff',
    alignItems: 'center', justifyContent: 'center',
  },
  authButtonText: { color: '#041010', fontSize: 14, fontWeight: '800' },
  authButtonSecondary: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  authButtonSecondaryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  passkeyHintWrap: {
    position: 'absolute',
    top: 72,
    left: 12,
    right: 12,
    zIndex: 110,
  },
  passkeyHintCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(17,17,17,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    gap: 10,
  },
  passkeyHintTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  passkeyHintCopy: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18 },
})
