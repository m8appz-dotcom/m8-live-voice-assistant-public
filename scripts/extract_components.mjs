import fs from 'fs'

const code = fs.readFileSync('app/live.tsx', 'utf8')
const lines = code.split('\n')

function extractFunction(name) {
  const start = lines.findIndex(l => l.startsWith(`function ${name}(`) || l.startsWith(`const ${name} =`))
  let end = start
  let braces = 0
  let started = false
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]
    for (const char of l) {
      if (char === '{') { braces++; started = true }
      else if (char === '}') { braces-- }
    }
    if (started && braces === 0) {
      end = i
      break
    }
  }
  return lines.slice(start, end + 1).join('\n')
}

// 1. Extract ThreeOrb
let orbCode = extractFunction('ThreeOrb')
orbCode = orbCode.replace('clock.getDelta() // drain delta', '// clock.getDelta removed')
const disposeCode = `
      renderer.dispose()
      orbGeometry.dispose()
      orbMaterial.dispose()
      wireGeometry.dispose()
      wireMaterial.dispose()
      coreGeometry.dispose()
      coreMaterial.dispose()
      particleGeometry.dispose()
      particleMaterial.dispose()
      starGeometry.dispose()
      starMaterial.dispose()`
orbCode = orbCode.replace('destroyed = true', 'destroyed = true' + disposeCode)
orbCode = `import React, { useEffect, useRef } from 'react'\nimport type { SessionState } from '../src/types/realtime'\n\nexport default ` + orbCode
fs.writeFileSync('components/ThreeOrb.tsx', orbCode)

// 2. Extract PulseBadge
let pulseCode = extractFunction('PulseBadge')
pulseCode = `import React, { useEffect, useRef } from 'react'\nimport { Animated as RNAnimated, Text } from 'react-native'\n\nexport default ` + pulseCode
fs.writeFileSync('components/PulseBadge.tsx', pulseCode)

// 3. Extract AudioSpectrum
let specCode = extractFunction('AudioSpectrum')
const specStart = lines.findIndex(l => l.startsWith('const BAR_COUNT'))
const specStylesStart = lines.findIndex(l => l.startsWith('const specS = StyleSheet.create({'))
const specStylesEnd = lines.findIndex((l, i) => i > specStylesStart && l.startsWith('})'))
const specStyles = lines.slice(specStylesStart, specStylesEnd + 1).join('\n')

specCode = `import React, { useEffect, useRef, useState } from 'react'\nimport { Platform, View, StyleSheet } from 'react-native'\nimport type { SessionState } from '../src/types/realtime'\n\n${lines[specStart]}\n\nexport default ` + specCode + '\n\n' + specStyles
fs.writeFileSync('components/AudioSpectrum.tsx', specCode)

console.log('Components extracted.')
