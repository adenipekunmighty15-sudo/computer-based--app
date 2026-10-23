import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { useAllowAmbient, useTabVisible } from '../../lib/hooks'

/* The decorative room behind the sign-in card.

   Three rules keep it cheap enough to sit on the first screen a student ever
   sees. It never runs for a reader who asked for less motion — `useAllowAmbient`
   hands back the flat gradient instead. It stops requesting frames when the tab
   is in the background. And it fetches nothing: the reflections that make the
   metals read as metal are rendered locally from lightformers rather than
   pulled from a third-party CDN, so a locked-down school network cannot leave
   this screen half-built. */

interface SceneProps {
  children: React.ReactNode
  background?: boolean
  /** Clear colour. Opaque, so the page behind the canvas can never show
      through as a pale wash — the room paints itself. */
  clearColor?: string
}

export function Scene({ children, background = true, clearColor }: SceneProps) {
  const allowed = useAllowAmbient()
  const visible = useTabVisible()

  if (!allowed) return <div className="scene-fallback" style={clearColor ? { background: clearColor } : undefined} aria-hidden="true" />

  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 45 }}
      /* alpha:false makes the clear colour opaque. With alpha on, the page's
         own background shows through the canvas and the scene reads as a pale
         ghost of itself — which is the whole thing the scene is for. */
      gl={{ antialias: true, alpha: false, powerPreference: 'low-power' }}
      /* No tone mapping. ACESFilmic is applied to the background as well as the
         geometry, and it crushes a mid-dark saturated colour to almost black:
         #047857 measured [0,12,6] on screen. The room's colour is chosen by
         hand here, so it has to reach the screen unchanged. */
      flat
      style={clearColor ? { background: clearColor } : undefined}
      // A full-screen distort shader is fill-rate bound, so device pixels are
      // the expensive axis. 1.5 is the point where the drift stops reading as
      // soft; the extra cost of 2 is not visible behind a login form.
      dpr={[1, 1.5]}
      frameloop={visible ? 'always' : 'never'}
      className="scene-canvas"
    >
      <Suspense fallback={null}>
        {/* The background has to be a scene background, not a CSS colour on the
            wrapper. `gl.alpha:false` clears the drawing buffer to black before
            the first frame, and only <color attach="background"> tells the
            renderer to clear it to something else — a style on the wrapper is
            painted behind an opaque canvas and never seen. */}
        {clearColor ? <color attach="background" args={[clearColor]} /> : null}

        {/* Lit for legibility, not for realism. With tone mapping off the metals
            need real intensity to separate from the clear colour — these were
            halved while ACES was still doing the work. */}
        <ambientLight intensity={1.1} />
        <pointLight position={[10, 10, 10]} intensity={2.2} />
        <spotLight position={[-10, 10, 10]} angle={0.15} penumbra={1} intensity={2} />

        {background && (
          /* Baked once into a small cubemap instead of downloaded. The solids
             and the seal are metals, and a metal with nothing to reflect is just
             a dark shape — these panels are what keep them legible. */
          <Environment resolution={64} frames={1}>
            <Lightformer intensity={1.4} color="#8fdef0" position={[0, 4, -6]} scale={[10, 4, 1]} />
            <Lightformer intensity={0.7} color="#5cc8e0" position={[-5, 0, -4]} scale={[6, 6, 1]} />
            <Lightformer intensity={0.5} color="#c9a227" position={[5, -2, -5]} scale={[5, 3, 1]} />
          </Environment>
        )}

        {children}
      </Suspense>
    </Canvas>
  )
}
