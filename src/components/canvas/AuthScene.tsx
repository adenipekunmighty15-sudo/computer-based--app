import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei'
import { Scene } from './Scene'

/* The room behind the sign-in doors.

   This whole file is loaded lazily, and it is the only thing in the app that
   imports three.js. That is the point of the split: the renderer and its
   helpers are several hundred kilobytes, and a student on the school network
   should be able to read the form and start typing while that arrives — or
   never arrive at all, if they have asked for less motion. Until it does, the
   static gradient holds the space so the layout does not jump.

   Nothing here fetches. The one thing that did — troika's <Text>, which pulls a
   font before it can draw — put a network request inside the Suspense boundary,
   so on a locked-down school network the scene never appeared at all. The seal
   is two boxes now, and the dust is a shader. */

/* ── Camera ────────────────────────────────────────────────────────────────

   The whole room leans toward the pointer. This is the one animation that makes
   a flat background read as a space: the parallax between the near solids and
   the far fluid is what tells the eye there is depth behind the words, and it
   cannot be faked with more geometry. Damped rather than set, so the camera
   eases into position and never snaps — a snapping camera on a login screen
   reads as a glitch. */

function CameraRig({ amount = 0.7 }: { amount?: number }) {
  useFrame((state, delta) => {
    const cam = state.camera
    const p = state.pointer
    // pointer.y is inverted relative to screen space: up is +1 there.
    cam.position.x = THREE.MathUtils.damp(cam.position.x, p.x * amount, 2.5, delta)
    cam.position.y = THREE.MathUtils.damp(cam.position.y, p.y * amount * 0.6, 2.5, delta)
    // Counter-move the look target so the room swings *around* the seal instead
    // of sliding sideways off it.
    cam.lookAt(p.x * -0.25, p.y * -0.15, 0)
  })
  return null
}

/* ── The school seal ───────────────────────────────────────────────────────

   The mark carries the accent and the plate carries the room's own tone, so the
   T is the part that changes colour when the portal changes — reading as the
   thing being switched rather than as a static badge behind it.

   Three motions stacked: the plate breathes, the rings counter-rotate at their
   own rates, and the whole assembly tips toward the pointer. */

function SealRings({ color }: { color: string }) {
  const group = useRef<THREE.Group>(null)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.getElapsedTime()
    // Each ring spins on its own axis at its own rate, so the assembly never
    // repeats a shape over the loop.
    g.children[0].rotation.z = t * 0.22
    g.children[1].rotation.x = t * -0.16
    g.children[2].rotation.y = t * 0.3
    // A slow nod, so the rings read as a gyroscope rather than as a flat decal
    // spinning on the wall.
    g.rotation.x = Math.sin(t * 0.4) * 0.35
  })

  return (
    <group ref={group}>
      {[1.55, 1.95, 2.35].map((r, i) => (
        <mesh key={r} rotation={[i * 0.7, i * 1.1, 0]}>
          <torusGeometry args={[r, 0.006, 8, 96]} />
          {/* Normal blending, not additive. The room is a light surface, and an
              additive ring on a bright background is mathematically guaranteed
              to wash out — it can only ever add light to something already
              light. depthWrite off so the rings do not clip each other. */}
          <meshBasicMaterial color={color} transparent opacity={0.34 - i * 0.08} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function LiquidLogo({ color, plate }: { color: string; plate: string }) {
  const root = useRef<THREE.Group>(null)

  useFrame((state) => {
    const g = root.current
    if (!g) return
    const p = state.pointer
    const t = state.clock.getElapsedTime()
    // Breathing on two incommensurate periods, so the pulse never lands on a
    // beat the eye can lock onto.
    const s = 1 + Math.sin(t * 0.9) * 0.03 + Math.sin(t * 0.37) * 0.018
    g.scale.setScalar(s)
    g.rotation.y = p.x * 0.5
    g.rotation.x = -p.y * 0.35
  })

  return (
    <Float speed={1.6} rotationIntensity={0.35} floatIntensity={0.55}>
      <group ref={root}>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[1, 1, 0.3]} />
          <MeshDistortMaterial color={plate} speed={2} distort={0.4} radius={1} metalness={0.8} roughness={0.2} />
        </mesh>
        {/* The T: a bar across the top of the plate and a stem down its middle.
            Unlit on purpose — an emissive accent is what makes it read as lit
            rather than as another solid catching the room's reflections. */}
        <mesh position={[0, 0.24, 0.19]}>
          <boxGeometry args={[0.62, 0.18, 0.06]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.09, 0.19]}>
          <boxGeometry args={[0.2, 0.5, 0.06]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <SealRings color={color} />
      </group>
    </Float>
  )
}

/* ── The room ───────────────────────────────────────────────────────────────

   Two counter-rotating fluid planes. One alone gives a soft gradient that reads
   as a vignette; two moving against each other give parallax inside the
   background itself, so the room has depth even where no solid has drifted to. */

function BackgroundFluid({ color, variant }: { color: string; variant: 'far' | 'near' }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const near = variant === 'near'

  useFrame((state) => {
    const mesh = meshRef.current
    if (!mesh) return
    const t = state.clock.getElapsedTime()
    // Opposite directions and different rates. If these matched, the composite
    // would pulse as one shape and the depth would collapse.
    mesh.rotation.x = t * (near ? -0.13 : 0.08)
    mesh.rotation.y = t * (near ? 0.07 : -0.04)
  })

  return (
    <mesh ref={meshRef} position={[0, 0, near ? -0.6 : -2.4]} scale={[near ? 9 : 12, near ? 9 : 12, 1]}>
      {/* 32 segments is already past the point where the distortion reads as
          smooth at this blur level; 64 doubled the vertex cost for no visible
          gain on a plane this soft. */}
      <planeGeometry args={[10, 10, 32, 32]} />
      <MeshDistortMaterial
        color={color}
        speed={near ? 2.1 : 1.3}
        distort={near ? 0.5 : 0.7}
        radius={1}
        transparent
        opacity={near ? 0.3 : 0.42}
      />
    </mesh>
  )
}

// The solid geometries a geometry lesson is actually built from: the Platonic
// solids plus the prisms and pyramids a secondary-school syllabus names. A
// hexagonal prism is the shape this school is named for, so it leads.
const SHAPES = ['hexPrism', 'icosahedron', 'tetrahedron', 'octahedron', 'cube', 'cone', 'pentagon', 'torusKnot', 'dodeca', 'cylinder'] as const
type ShapeName = (typeof SHAPES)[number]

// Deterministic pseudo-random keeps the full-screen field stable on every
// render while still giving the eye movement across the whole room.
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const FIELD: { shape: ShapeName; position: [number, number, number]; scale: number; spin: [number, number, number]; speed: number }[] = Array.from(
  { length: 24 },
  (_, i) => {
    return {
      shape: SHAPES[i % SHAPES.length],
      position: [(seeded(i, 1) - 0.5) * 13, (seeded(i, 2) - 0.5) * 7.5, -1.5 - seeded(i, 3) * 4],
      scale: 0.14 + seeded(i, 4) * 0.32,
      spin: [
        (seeded(i, 5) - 0.5) * 0.5,
        (seeded(i, 6) - 0.5) * 0.5,
        (seeded(i, 7) - 0.5) * 0.4,
      ],
      speed: 0.6 + seeded(i, 8) * 1.1,
    }
  },
)

function ShapeGeometry({ shape }: { shape: ShapeName }) {
  switch (shape) {
    case 'hexPrism':
      return <cylinderGeometry args={[1, 1, 1.3, 6]} />
    case 'pentagon':
      return <cylinderGeometry args={[1, 1, 1.2, 5]} />
    case 'icosahedron':
      return <icosahedronGeometry args={[1, 0]} />
    case 'dodeca':
      return <dodecahedronGeometry args={[1, 0]} />
    case 'tetrahedron':
      return <tetrahedronGeometry args={[1.1, 0]} />
    case 'octahedron':
      return <octahedronGeometry args={[1.05, 0]} />
    case 'cube':
      return <boxGeometry args={[1.4, 1.4, 1.4]} />
    case 'cone':
      return <coneGeometry args={[1, 1.5, 6]} />
    case 'torusKnot':
      return <torusKnotGeometry args={[0.7, 0.24, 64, 8]} />
    case 'cylinder':
      return <cylinderGeometry args={[0.8, 0.8, 1.6, 24]} />
  }
}

function FloatingSolid({
  shape,
  position,
  scale,
  spin,
  speed,
  accent,
  dim,
}: {
  shape: ShapeName
  position: [number, number, number]
  scale: number
  spin: [number, number, number]
  speed: number
  accent: string
  dim: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    const mesh = ref.current
    if (!mesh) return
    const t = state.clock.getElapsedTime()
    mesh.rotation.x += spin[0] * delta * speed
    mesh.rotation.y += spin[1] * delta * speed
    mesh.rotation.z += spin[2] * delta * speed
    // A slow vertical drift keeps the field alive without a physics cost, and a
    // slight lean toward the pointer sells the parallax on the solids nearest
    // the camera.
    mesh.position.y = position[1] + Math.sin(t * 0.5 * speed + position[0]) * 0.16
    mesh.rotation.y += state.pointer.x * 0.0025 * (1 + position[2] * 0.1)
  })

  return (
    <mesh ref={ref} position={position} scale={scale} rotation={position}>
      <ShapeGeometry shape={shape} />
      <meshStandardMaterial
        color={accent}
        metalness={0.55}
        roughness={0.25}
        transparent
        opacity={dim ? 0.3 : 0.72}
        flatShading={shape !== 'torusKnot'}
      />
    </mesh>
  )
}

// The floating solids fill the room behind both story and form. The foreground
// layers provide hierarchy; the field itself is allowed to cross the middle.
function SolidField({ accent, dim }: { accent: string; dim: boolean }) {
  const group = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (group.current) group.current.rotation.y = state.clock.getElapsedTime() * 0.02
  })

  return (
    <group ref={group}>
      {FIELD.map((s, i) => (
        <FloatingSolid key={i} {...s} accent={accent} dim={dim} />
      ))}
    </group>
  )
}

/* Two lights that sweep rather than sit still. A static key light in a room
   full of drifting metal produces highlights that stay welded to the geometry,
   which is the tell that nothing is actually moving. Sweeping the key is what
   makes the metal flicker as the solids turn through it. */

function SweepingLights({ accent }: { accent: string }) {
  const key = useRef<THREE.PointLight>(null)
  const fill = useRef<THREE.PointLight>(null)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    if (key.current) {
      key.current.position.set(Math.cos(t * 0.35) * 9, 5 + Math.sin(t * 0.5) * 3, 6 + Math.sin(t * 0.35) * 2)
    }
    if (fill.current) {
      fill.current.position.set(Math.sin(t * 0.28) * -8, -4 + Math.cos(t * 0.4) * 3, 4 + Math.cos(t * 0.28) * 2)
    }
  })

  return (
    <>
      <pointLight ref={key} color={accent} intensity={2.6} distance={34} decay={1.6} />
      <pointLight ref={fill} color="#8fdef0" intensity={1.5} distance={30} decay={1.6} />
    </>
  )
}

export default function AuthScene({ accent, sceneColor }: { accent: string; sceneColor: string }) {
  return (
    /* The clear colour is the room's own tone, so the room is lit by the portal
       colour instead of sitting on the app's page fill. */
    <Scene clearColor={sceneColor}>
      <CameraRig />
      <SweepingLights accent={accent} />
      <BackgroundFluid color={sceneColor} variant="far" />
      <BackgroundFluid color={sceneColor} variant="near" />
      <Sparkles count={54} scale={[16, 10, 5]} position={[0, 0, -1.5]} size={2.6} speed={0.28} opacity={0.42} color={accent} />
      <SolidField accent={accent} dim={false} />
      <LiquidLogo color={accent} plate={sceneColor} />
    </Scene>
  )
}
