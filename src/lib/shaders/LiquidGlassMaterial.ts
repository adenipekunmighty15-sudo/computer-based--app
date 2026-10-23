import * as THREE from 'three';
import { NoiseUtils } from './NoiseUtils';

export const LiquidGlassMaterial = {
  uniforms: {
    uTime: { value: 0 },
    uColorA: { value: new THREE.Color('#D4AF37') },
    uColorB: { value: new THREE.Color('#1E40AF') },
    uResolution: { value: new THREE.Vector2() },
    uMouse: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float uTime;

    void main() {
      vUv = uv;
      vPosition = position;

      // Subtle organic displacement
      float displacement = sin(position.x * 2.0 + uTime) * 0.1;
      vec3 newPosition = position + normal * displacement;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
  `,
  fragmentShader: `
    ${NoiseUtils}
    varying vec2 vUv;
    varying vec3 vPosition;
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec2 uResolution;
    uniform vec2 uMouse;

    void main() {
      vec2 uv = vUv;

      // Create a liquid distortion using noise
      float noise = snoise(vec3(uv * 3.0, uTime * 0.2)) * 0.5 + 0.5;

      // Chromatic Aberration effect
      float r = texture2D(uResolution, uv + vec2(0.005 * noise, 0.0)).r;
      float g = texture2D(uResolution, uv).g;
      float b = texture2D(uResolution, uv - vec2(0.005 * noise, 0.0)).b;

      // Fresnel Rim light
      float fresnel = pow(1.0 - dot(vPosition, vec3(0.0, 0.0, 1.0)), 3.0);

      vec3 color = mix(uColorA, uColorB, noise);
      color += fresnel * 0.5;

      gl_FragColor = vec4(color, 0.8);
    }
  `
};
