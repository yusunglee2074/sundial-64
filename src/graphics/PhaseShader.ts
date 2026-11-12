import * as THREE from 'three';
import { WorldPhase } from '../types';

export interface PhaseUniforms {
  uWaveOrigin: { value: THREE.Vector3 };
  uWaveRadius: { value: number };
  uWaveActive: { value: number };
  uTargetLuna: { value: number };
  uGlobalLuna: { value: number };
  uTime: { value: number };
}

export class PhaseVisualManager {
  public readonly uniforms: PhaseUniforms = {
    uWaveOrigin: { value: new THREE.Vector3(0, 2, 36) },
    uWaveRadius: { value: 999 },
    uWaveActive: { value: 0 },
    uTargetLuna: { value: 0 },
    uGlobalLuna: { value: 0 },
    uTime: { value: 0 },
  };

  private waveProgress = 1;
  private currentPhase: WorldPhase = 'sol';

  public triggerPhaseWave(toPhase: WorldPhase, origin: THREE.Vector3): void {
    this.currentPhase = toPhase;
    this.uniforms.uWaveOrigin.value.copy(origin);
    this.uniforms.uWaveRadius.value = 0.1;
    this.uniforms.uWaveActive.value = 1.0;
    this.uniforms.uTargetLuna.value = toPhase === 'luna' ? 1.0 : 0.0;
    this.waveProgress = 0;
  }

  public setImmediatePhase(phase: WorldPhase): void {
    this.currentPhase = phase;
    const v = phase === 'luna' ? 1.0 : 0.0;
    this.uniforms.uGlobalLuna.value = v;
    this.uniforms.uTargetLuna.value = v;
    this.uniforms.uWaveActive.value = 0.0;
    this.uniforms.uWaveRadius.value = 999;
    this.waveProgress = 1;
  }

  public update(dt: number): number {
    this.uniforms.uTime.value += dt;

    if (this.waveProgress < 1) {
      this.waveProgress = Math.min(1, this.waveProgress + dt * 1.28);
      const eased = 1 - Math.pow(1 - this.waveProgress, 2.0);
      this.uniforms.uWaveRadius.value = eased * 215;

      const target = this.currentPhase === 'luna' ? 1 : 0;
      const start = 1 - target;
      this.uniforms.uGlobalLuna.value = start + (target - start) * eased;

      if (this.waveProgress >= 1) {
        this.uniforms.uWaveActive.value = 0;
        this.uniforms.uGlobalLuna.value = target;
      }
    }

    return this.uniforms.uGlobalLuna.value;
  }

  /**
   * Enhances a MeshStandardMaterial so the 3D radial Sol/Luna shockwave sweeps across it
   * and shifts its palette & luminescence dynamically!
   */
  public makePhaseMaterial(
    params: THREE.MeshStandardMaterialParameters & {
      lunaTint?: THREE.ColorRepresentation;
      lunaEmissive?: THREE.ColorRepresentation;
    }
  ): THREE.MeshStandardMaterial {
    const { lunaTint = 0x5570b8, lunaEmissive = 0x0a132e, ...stdParams } = params;
    const mat = new THREE.MeshStandardMaterial(stdParams);
    const lunaColor = new THREE.Color(lunaTint);
    const lunaEmis = new THREE.Color(lunaEmissive);

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaveOrigin = this.uniforms.uWaveOrigin;
      shader.uniforms.uWaveRadius = this.uniforms.uWaveRadius;
      shader.uniforms.uWaveActive = this.uniforms.uWaveActive;
      shader.uniforms.uTargetLuna = this.uniforms.uTargetLuna;
      shader.uniforms.uGlobalLuna = this.uniforms.uGlobalLuna;
      shader.uniforms.uLunaTint = { value: lunaColor };
      shader.uniforms.uLunaEmissive = { value: lunaEmis };

      shader.vertexShader =
        `varying vec3 vWorldPosPhase;\n` +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 phaseWp = modelMatrix * vec4( transformed, 1.0 );
          vWorldPosPhase = phaseWp.xyz;`
        );

      shader.fragmentShader =
        `varying vec3 vWorldPosPhase;
        uniform vec3 uWaveOrigin;
        uniform float uWaveRadius;
        uniform float uWaveActive;
        uniform float uTargetLuna;
        uniform float uGlobalLuna;
        uniform vec3 uLunaTint;
        uniform vec3 uLunaEmissive;\n` +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `float localLuna = uGlobalLuna;
          float waveRing = 0.0;
          if (uWaveActive > 0.5) {
            float d = distance(vWorldPosPhase, uWaveOrigin);
            float inside = 1.0 - smoothstep(uWaveRadius - 3.2, uWaveRadius + 3.2, d);
            localLuna = mix(1.0 - uTargetLuna, uTargetLuna, inside);
            waveRing = exp(-pow((d - uWaveRadius) * 0.42, 2.0));
          }
          vec3 lunaShifted = gl_FragColor.rgb * uLunaTint * 1.32 + uLunaEmissive;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, lunaShifted, localLuna * 0.78);
          vec3 ringCol = mix(vec3(1.0, 0.82, 0.28), vec3(0.32, 0.95, 1.0), uTargetLuna);
          gl_FragColor.rgb += ringCol * waveRing * 1.15;
          #include <dithering_fragment>`
        );
    };

    mat.customProgramCacheKey = () => `phase_std_${lunaColor.getHexString()}_${lunaEmis.getHexString()}`;
    return mat;
  }
}

// ==================== PROCEDURAL N64-CRISP TEXTURES ====================

export function createCheckerGrassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  const tile = 64;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const bright = (x + y) % 2 === 0;
      ctx.fillStyle = bright ? '#48b84c' : '#3a9f40';
      ctx.fillRect(x * tile, y * tile, tile, tile);

      // Crisp N64 pixel grass tufts
      ctx.fillStyle = bright ? '#62cf60' : '#4eb653';
      for (let i = 0; i < 18; i++) {
        const gx = x * tile + ((i * 29 + y * 13) % (tile - 6));
        const gy = y * tile + ((i * 43 + x * 17) % (tile - 8));
        ctx.fillRect(gx, gy, 3, 6);
      }
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStoneBrickTexture(baseHex = '#d8cbb8', mortarHex = '#a69682'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = mortarHex;
  ctx.fillRect(0, 0, 256, 256);

  const rows = 8;
  const cols = 4;
  const rh = 256 / rows;
  const cw = 256 / cols;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cw * 0.5);
    for (let col = -1; col <= cols; col++) {
      const bx = col * cw + offset + 2;
      const by = r * rh + 2;
      ctx.fillStyle = baseHex;
      ctx.fillRect(bx, by, cw - 4, rh - 4);

      // Subtle bevel highlight
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(bx, by, cw - 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(bx, by + rh - 7, cw - 4, 3);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSundialPlazaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#e7dcc8';
  ctx.fillRect(0, 0, 512, 512);

  const cx = 256;
  const cy = 256;

  // Concentric stone rings
  const rings = [242, 205, 150, 92, 42];
  rings.forEach((r, idx) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = idx % 2 === 0 ? '#dfd1b8' : '#cbb899';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#998262';
    ctx.stroke();
  });

  // 12 radial brass sundial rays
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = i % 3 === 0 ? '#d89b2b' : '#9c8667';
    ctx.beginPath();
    ctx.moveTo(-6, 44);
    ctx.lineTo(6, 44);
    ctx.lineTo(2, 236);
    ctx.lineTo(-2, 236);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Center sun/moon emblem
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#f2b63d';
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBrassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#f3be4b');
  grad.addColorStop(0.5, '#cd8e27');
  grad.addColorStop(1, '#f0b643');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(95, 58, 10, 0.35)';
  ctx.lineWidth = 4;
  for (let r = 24; r < 128; r += 26) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWaterfallTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#31b8e8';
  ctx.fillRect(0, 0, 256, 256);

  // Vertical foam & crystal streaks
  for (let i = 0; i < 42; i++) {
    const x = (i * 37) % 256;
    const y = (i * 61) % 256;
    const w = 6 + (i % 10);
    const h = 44 + (i % 60);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.78)' : 'rgba(155,238,255,0.55)';
    ctx.fillRect(x, y, w, h);
    if (y + h > 256) {
      ctx.fillRect(x, y - 256, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPhaseBlockTexture(kind: 'sol' | 'luna'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = kind === 'sol' ? '#ffae2b' : '#4a7cff';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = kind === 'sol' ? '#fff0a6' : '#aef4ff';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 116, 116);

  // Inner emblem
  ctx.beginPath();
  ctx.arc(64, 64, 26, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
