import React, { useEffect, useRef } from 'react'
import type { SessionState } from '../src/types/realtime'

export default function ThreeOrb({ state, micLevel, rotSpeed = 1.0, distortion = 1.3 }: {
  state: SessionState; micLevel: number; rotSpeed?: number; distortion?: number
}) {
  const containerRef = useRef<any>(null)
  const stateRef = useRef(state)
  const micRef = useRef(micLevel)
  const rotSpeedRef = useRef(rotSpeed)
  const distortionRef = useRef(distortion)

  useEffect(() => { stateRef.current = state }, [state])
  useEffect(() => { micRef.current = micLevel }, [micLevel])
  useEffect(() => { rotSpeedRef.current = rotSpeed }, [rotSpeed])
  useEffect(() => { distortionRef.current = distortion }, [distortion])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let destroyed = false
    const disposables: any[] = []

    const initThree = async () => {
      const THREE = await import('three')
      if (destroyed) return

      const ORB_SIZE = 200
      const w = ORB_SIZE * 1.8, h = ORB_SIZE * 1.8
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100)
      camera.position.z = 3.5

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      disposables.push(renderer)
      renderer.setSize(w, h)
      renderer.setPixelRatio(dpr)
      renderer.setClearColor(0x000000, 0)
      container.appendChild(renderer.domElement)

      // ─── GLSL Simplex Noise ───
      const noiseGLSL = `
        vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
        vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
        vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
        float snoise(vec3 v){
          const vec2 C=vec2(1.0/6.0,1.0/3.0);
          const vec4 D=vec4(0.0,0.5,1.0,2.0);
          vec3 i=floor(v+dot(v,C.yyy));
          vec3 x0=v-i+dot(i,C.xxx);
          vec3 g=step(x0.yzx,x0.xyz);
          vec3 l=1.0-g;
          vec3 i1=min(g.xyz,l.zxy);
          vec3 i2=max(g.xyz,l.zxy);
          vec3 x1=x0-i1+C.xxx;
          vec3 x2=x0-i2+C.yyy;
          vec3 x3=x0-D.yyy;
          i=mod289(i);
          vec4 p=permute(permute(permute(
            i.z+vec4(0.0,i1.z,i2.z,1.0))
            +i.y+vec4(0.0,i1.y,i2.y,1.0))
            +i.x+vec4(0.0,i1.x,i2.x,1.0));
          float n_=0.142857142857;
          vec3 ns=n_*D.wyz-D.xzx;
          vec4 j=p-49.0*floor(p*ns.z*ns.z);
          vec4 x_=floor(j*ns.z);
          vec4 y_=floor(j-7.0*x_);
          vec4 x=x_*ns.x+ns.yyyy;
          vec4 y=y_*ns.x+ns.yyyy;
          vec4 h=1.0-abs(x)-abs(y);
          vec4 b0=vec4(x.xy,y.xy);
          vec4 b1=vec4(x.zw,y.zw);
          vec4 s0=floor(b0)*2.0+1.0;
          vec4 s1=floor(b1)*2.0+1.0;
          vec4 sh=-step(h,vec4(0.0));
          vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
          vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
          vec3 p0=vec3(a0.xy,h.x);
          vec3 p1=vec3(a0.zw,h.y);
          vec3 p2=vec3(a1.xy,h.z);
          vec3 p3=vec3(a1.zw,h.w);
          vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
          p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
          vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
          m=m*m;
          return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
        }
      `

      const orbVertexShader = `
        ${noiseGLSL}
        uniform float uTime;
        uniform float uNoiseAmp;
        uniform float uNoiseFreq;
        uniform float uNoiseSpeed;
        uniform float uPulse;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vDisplacement;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec3 pos = position;
          float n = snoise(pos * uNoiseFreq + uTime * uNoiseSpeed);
          n += 0.5 * snoise(pos * uNoiseFreq * 2.0 + uTime * uNoiseSpeed * 1.3);
          float displacement = n * uNoiseAmp;
          displacement += sin(uTime * 2.0) * uPulse * 0.02;
          vDisplacement = displacement;
          pos += normal * displacement;
          vPosition = (modelViewMatrix * vec4(pos, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `

      const orbFragmentShader = `
        uniform vec3 uColor;
        uniform vec3 uCoreColor;
        uniform float uFresnelPower;
        uniform float uCoreIntensity;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vDisplacement;
        varying vec2 vUv;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float fresnel = pow(1.0 - max(dot(viewDir, vNormal), 0.0), uFresnelPower);
          vec3 core = uCoreColor * uCoreIntensity * (1.0 - fresnel);
          float dispColor = smoothstep(-0.15, 0.15, vDisplacement);
          vec3 baseColor = mix(uColor * 0.4, uColor, dispColor);
          vec3 rimColor = uColor * 1.5 + vec3(0.2);
          vec3 finalColor = baseColor * (1.0 - fresnel * 0.7) + rimColor * fresnel * 0.8 + core;
          float alpha = 0.15 + fresnel * 0.75 + dispColor * 0.1;
          alpha = clamp(alpha, 0.0, 1.0);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `

      const coreVertexShader = `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `

      const coreFragmentShader = `
        uniform vec3 uColor;
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vec3 viewDir = normalize(-vPosition);
          float d = max(dot(viewDir, vNormal), 0.0);
          float core = pow(d, 3.0) * uIntensity;
          vec3 col = mix(uColor, vec3(1.0), 0.5) * core;
          float alpha = core * 0.9;
          gl_FragColor = vec4(col, alpha);
        }
      `

      const hexToVec3 = (hex: string) => {
        const h = hex.replace('#', '')
        return new THREE.Vector3(
          parseInt(h.slice(0, 2), 16) / 255,
          parseInt(h.slice(2, 4), 16) / 255,
          parseInt(h.slice(4, 6), 16) / 255,
        )
      }

      // Orb mesh
      const orbGeometry = new THREE.SphereGeometry(1, 128, 128)
      const orbMaterial = new THREE.ShaderMaterial({
        vertexShader: orbVertexShader,
        fragmentShader: orbFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: hexToVec3('#4DA6FF') },
          uCoreColor: { value: new THREE.Vector3(1, 1, 1) },
          uNoiseAmp: { value: 0.06 },
          uNoiseFreq: { value: 1.5 },
          uNoiseSpeed: { value: 0.3 },
          uPulse: { value: 0 },
          uFresnelPower: { value: 2.5 },
          uCoreIntensity: { value: 0.4 },
        },
      })
      disposables.push(orbGeometry, orbMaterial)
      const orbMesh = new THREE.Mesh(orbGeometry, orbMaterial)
      scene.add(orbMesh)

      // Wireframe overlay
      const wireGeometry = new THREE.IcosahedronGeometry(1.02, 3)
      const wireMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08,
      })
      disposables.push(wireGeometry, wireMaterial)
      const wireMesh = new THREE.Mesh(wireGeometry, wireMaterial)
      scene.add(wireMesh)

      // Inner core
      const coreGeometry = new THREE.SphereGeometry(0.55, 48, 48)
      const coreMaterial = new THREE.ShaderMaterial({
        vertexShader: coreVertexShader,
        fragmentShader: coreFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: hexToVec3('#4DA6FF') },
          uIntensity: { value: 1.0 },
        },
      })
      disposables.push(coreGeometry, coreMaterial)
      const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial)
      scene.add(coreMesh)

      // Particles
      const PARTICLE_COUNT = 200
      const particleGeometry = new THREE.BufferGeometry()
      const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
      const particleOffsets = new Float32Array(PARTICLE_COUNT)
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        const r = 1.2 + Math.random() * 0.6
        particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
        particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
        particlePositions[i * 3 + 2] = r * Math.cos(phi)
        particleOffsets[i] = Math.random() * Math.PI * 2
      }
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
      const particleMaterial = new THREE.PointsMaterial({
        size: 0.018, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff,
      })
      disposables.push(particleGeometry, particleMaterial)
      const particles = new THREE.Points(particleGeometry, particleMaterial)
      scene.add(particles)

      // Star field
      const STAR_COUNT = 120
      const starGeometry = new THREE.BufferGeometry()
      const starPositions = new Float32Array(STAR_COUNT * 3)
      for (let i = 0; i < STAR_COUNT; i++) {
        starPositions[i * 3] = (Math.random() - 0.5) * 20
        starPositions[i * 3 + 1] = (Math.random() - 0.5) * 20
        starPositions[i * 3 + 2] = -5 - Math.random() * 15
      }
      starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      const starMaterial = new THREE.PointsMaterial({
        size: 0.03, transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending, depthWrite: false, color: 0x8888cc,
      })
      disposables.push(starGeometry, starMaterial)
      const stars = new THREE.Points(starGeometry, starMaterial)
      scene.add(stars)

      // Smoothing
      let smoothMic = 0, smoothNoiseAmp = 0.06, smoothNoiseFreq = 1.5
      let smoothNoiseSpeed = 0.3, smoothPulse = 0, smoothBloom = 8
      let smoothParticleOpacity = 0.3, smoothParticleSpread = 0
      let smoothRotSpeed = 0.15, smoothCoreIntensity = 0.4
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t

      const clock = new THREE.Clock()

      const animate = () => {
        if (destroyed) return
        requestAnimationFrame(animate)
        const elapsed = clock.getElapsedTime()
        // clock.getDelta removed
        const st = stateRef.current
        const mic = micRef.current

        smoothMic = lerp(smoothMic, mic, 0.15)

        // State-to-visual mapping for SessionState
        let tNoiseAmp = 0.06, tNoiseFreq = 1.5, tNoiseSpeed = 0.3, tPulse = 0
        let tGlow = 8, tParticleOpacity = 0.3, tParticleSpread = 0, tRotSpeed = 0.15
        let tCoreIntensity = 0.4, tWireOpacity = 0.08
        let targetColor = hexToVec3('#4DA6FF')
        let fresnelPower = 2.5

        if (st === 'idle') {
          tNoiseAmp = 0.03; tNoiseFreq = 1.0; tNoiseSpeed = 0.15; tPulse = 0.2
          tGlow = 4; tParticleOpacity = 0.08; tRotSpeed = 0.04; tCoreIntensity = 0.15
          tWireOpacity = 0.03
          targetColor = hexToVec3('#555566')
        } else if (st === 'connecting') {
          tNoiseAmp = 0.04; tNoiseFreq = 1.2; tNoiseSpeed = 0.25; tPulse = 0.3
          tGlow = 6; tParticleOpacity = 0.12; tRotSpeed = 0.08; tCoreIntensity = 0.25
          tWireOpacity = 0.05
          targetColor = hexToVec3('#F97316')
        } else if (st === 'ready') {
          tNoiseAmp = 0.04; tNoiseFreq = 1.2; tNoiseSpeed = 0.2; tPulse = 0.25
          tGlow = 5; tParticleOpacity = 0.15; tRotSpeed = 0.07; tCoreIntensity = 0.2
          tWireOpacity = 0.05
          const wc = hexToVec3('#aaaacc'); wc.multiplyScalar(0.6); targetColor = wc
        } else if (st === 'listening') {
          tNoiseAmp = 0.08 + smoothMic * 0.25; tNoiseFreq = 1.8 + smoothMic * 0.8
          tNoiseSpeed = 0.4 + smoothMic * 0.3; tPulse = 0.1
          tGlow = 10 + smoothMic * 8; tParticleOpacity = 0.3 + smoothMic * 0.3
          tParticleSpread = smoothMic * 0.3; tRotSpeed = 0.12; tCoreIntensity = 0.5 + smoothMic * 0.3
          tWireOpacity = 0.1 + smoothMic * 0.15
          targetColor = hexToVec3('#34D399')
          fresnelPower = 2.0
        } else if (st === 'responding') {
          const audioFeel = 0.5 + Math.sin(elapsed * 4) * 0.2 + Math.sin(elapsed * 7) * 0.1
          tNoiseAmp = 0.12 + audioFeel * 0.1; tNoiseFreq = 2.0 + audioFeel * 0.5
          tNoiseSpeed = 0.5 + audioFeel * 0.3; tPulse = 0.5
          tGlow = 14 + audioFeel * 4; tParticleOpacity = 0.6; tParticleSpread = 0.15
          tRotSpeed = 0.18; tCoreIntensity = 0.8
          tWireOpacity = 0.13
          targetColor = hexToVec3('#4DA6FF')
          fresnelPower = 1.8
        } else if (st === 'thinking') {
          tNoiseAmp = 0.04; tNoiseFreq = 1.0; tNoiseSpeed = 0.15; tPulse = 0.3
          tGlow = 8; tParticleOpacity = 0.2; tRotSpeed = 0.06; tCoreIntensity = 0.3
          tWireOpacity = 0.05
          targetColor = hexToVec3('#8B5CF6')
        } else if (st === 'searching') {
          tNoiseAmp = 0.08; tNoiseFreq = 1.6; tNoiseSpeed = 0.4; tPulse = 0.5
          tGlow = 12; tParticleOpacity = 0.4; tParticleSpread = 0.1
          tRotSpeed = 0.3; tCoreIntensity = 0.5
          tWireOpacity = 0.1
          targetColor = hexToVec3('#F59E0B')
        } else if (st === 'error') {
          tNoiseAmp = 0.05; tNoiseFreq = 1.3; tNoiseSpeed = 0.5; tPulse = 0.6
          tGlow = 8; tParticleOpacity = 0.2; tRotSpeed = 0.1; tCoreIntensity = 0.3
          tWireOpacity = 0.07
          targetColor = hexToVec3('#ef4444')
        }

        const sm = 0.06
        smoothNoiseAmp = lerp(smoothNoiseAmp, tNoiseAmp, sm)
        smoothNoiseFreq = lerp(smoothNoiseFreq, tNoiseFreq, sm)
        smoothNoiseSpeed = lerp(smoothNoiseSpeed, tNoiseSpeed, sm)
        smoothPulse = lerp(smoothPulse, tPulse, sm)
        smoothBloom = lerp(smoothBloom, tGlow, sm)
        smoothParticleOpacity = lerp(smoothParticleOpacity, tParticleOpacity, sm)
        smoothParticleSpread = lerp(smoothParticleSpread, tParticleSpread, sm)
        smoothRotSpeed = lerp(smoothRotSpeed, tRotSpeed, sm)
        smoothCoreIntensity = lerp(smoothCoreIntensity, tCoreIntensity, sm)

        orbMaterial.uniforms.uTime.value = elapsed
        orbMaterial.uniforms.uNoiseAmp.value = smoothNoiseAmp * distortionRef.current
        orbMaterial.uniforms.uNoiseFreq.value = smoothNoiseFreq
        orbMaterial.uniforms.uNoiseSpeed.value = smoothNoiseSpeed
        orbMaterial.uniforms.uPulse.value = smoothPulse
        orbMaterial.uniforms.uFresnelPower.value = fresnelPower
        orbMaterial.uniforms.uCoreIntensity.value = smoothCoreIntensity

        const currentColor = orbMaterial.uniforms.uColor.value as typeof THREE.Vector3.prototype
        currentColor.lerp(targetColor, 0.04)
        coreMaterial.uniforms.uColor.value.copy(currentColor)
        coreMaterial.uniforms.uTime.value = elapsed
        coreMaterial.uniforms.uIntensity.value = smoothCoreIntensity

        orbMesh.rotation.y += smoothRotSpeed * rotSpeedRef.current * 0.016
        orbMesh.rotation.x = Math.sin(elapsed * 0.2) * 0.1
        coreMesh.rotation.y = orbMesh.rotation.y

        const scalePulse = st === 'responding'
          ? 1 + Math.sin(elapsed * 3) * 0.02
          : st === 'listening'
            ? 1 + Math.sin(elapsed * 2) * 0.015
            : 1
        orbMesh.scale.setScalar(scalePulse)
        coreMesh.scale.setScalar(0.55 * scalePulse)

        const posArr = particleGeometry.attributes.position.array as Float32Array
        const visibleCount = st === 'responding' ? PARTICLE_COUNT
          : st === 'listening' ? Math.floor(PARTICLE_COUNT * 0.4)
          : st === 'ready' ? Math.floor(PARTICLE_COUNT * 0.15)
          : Math.floor(PARTICLE_COUNT * 0.08)
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix = i * 3
          const offset = particleOffsets[i]
          const baseR = 1.2 + smoothParticleSpread + Math.sin(elapsed * 0.5 + offset) * 0.15
          const orbitSpeed = 0.3 + (i % 5) * 0.05
          const theta = elapsed * orbitSpeed + offset
          const phi = offset + Math.sin(elapsed * 0.2 + offset) * 0.3
          if (i < visibleCount) {
            posArr[ix] = baseR * Math.sin(phi) * Math.cos(theta)
            posArr[ix + 1] = baseR * Math.sin(phi) * Math.sin(theta)
            posArr[ix + 2] = baseR * Math.cos(phi)
          } else {
            posArr[ix] = 0; posArr[ix + 1] = 0; posArr[ix + 2] = 0
          }
        }
        particleGeometry.attributes.position.needsUpdate = true
        particleMaterial.opacity = smoothParticleOpacity
        const pc = (currentColor as any).clone()
        particleMaterial.color.setRGB(
          Math.min(1, pc.x + 0.3), Math.min(1, pc.y + 0.3), Math.min(1, pc.z + 0.3)
        )

        starMaterial.opacity = 0.15 + Math.sin(elapsed * 0.3) * 0.05
        stars.rotation.y = elapsed * 0.005

        wireMesh.rotation.y = orbMesh.rotation.y * 0.7
        wireMesh.rotation.x = elapsed * 0.05
        wireMaterial.opacity = lerp(wireMaterial.opacity, tWireOpacity, sm)

        const glowPx = Math.round(smoothBloom)
        const gc = (currentColor as any).clone()
        const hexStr = '#' + [gc.x, gc.y, gc.z].map((v: number) =>
          Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')
        ).join('')
        renderer.domElement.style.filter = `drop-shadow(0 0 ${glowPx}px ${hexStr})`

        renderer.render(scene, camera)
      }
      animate()
    }

    initThree()

    return () => {
      destroyed = true
      disposables.forEach(d => {
        if (d && typeof d.dispose === 'function') d.dispose()
      })
      // renderer cleanup handled by destroyed flag + container removal
      if (containerRef.current) {
        const canvas = containerRef.current.querySelector('canvas')
        if (canvas) try { containerRef.current.removeChild(canvas) } catch {}
      }
    }
  }, [])

  const ORB_SIZE = 200
  return (
    // @ts-ignore web div
    <div ref={containerRef} style={{ width: ORB_SIZE * 1.8, height: ORB_SIZE * 1.8 }} />
  )
}