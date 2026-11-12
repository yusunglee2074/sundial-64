import * as THREE from 'three';
import { WorldPhase } from '../types';

interface Particle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  gravity: number;
  color: THREE.Color;
}

interface ShockRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  maxRadius: number;
}

export class ParticleSystem {
  private readonly maxParticles = 360;
  private particles: Particle[] = [];
  private instanced: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  private rings: ShockRing[] = [];
  private ambientMesh: THREE.Points;
  private ambientMat: THREE.PointsMaterial;
  private ambientPositions: Float32Array;
  private ambientCount = 140;

  constructor(private scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(0.24, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
    });
    this.instanced = new THREE.InstancedMesh(geo, mat, this.maxParticles);
    this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instanced.frustumCulled = false;
    this.scene.add(this.instanced);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        life: 1,
        startScale: 1,
        endScale: 0.01,
        gravity: 0,
        color: new THREE.Color(0xffffff),
      });
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(i, this.dummy.matrix);
      this.instanced.setColorAt(i, new THREE.Color(0xffffff));
    }

    // Ambient floating motes (Golden pollen in Sol, cyan fireflies in Luna)
    this.ambientPositions = new Float32Array(this.ambientCount * 3);
    for (let i = 0; i < this.ambientCount; i++) {
      this.ambientPositions[i * 3 + 0] = (Math.random() - 0.5) * 140;
      this.ambientPositions[i * 3 + 1] = 2 + Math.random() * 46;
      this.ambientPositions[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const ambGeo = new THREE.BufferGeometry();
    ambGeo.setAttribute('position', new THREE.BufferAttribute(this.ambientPositions, 3));
    this.ambientMat = new THREE.PointsMaterial({
      color: 0xffe588,
      size: 0.55,
      transparent: true,
      opacity: 0.75,
    });
    this.ambientMesh = new THREE.Points(ambGeo, this.ambientMat);
    this.scene.add(this.ambientMesh);
  }

  private alloc(): Particle | null {
    for (let i = 0; i < this.maxParticles; i++) {
      if (!this.particles[i].active) return this.particles[i];
    }
    return null;
  }

  public spawnDust(pos: THREE.Vector3, count = 4, spread = 1.6): void {
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      p.active = true;
      p.pos.set(
        pos.x + (Math.random() - 0.5) * 0.5,
        pos.y + 0.12 + Math.random() * 0.2,
        pos.z + (Math.random() - 0.5) * 0.5
      );
      const a = Math.random() * Math.PI * 2;
      const spd = (0.4 + Math.random() * 0.8) * spread;
      p.vel.set(Math.cos(a) * spd, 0.8 + Math.random() * 1.4, Math.sin(a) * spd);
      p.age = 0;
      p.life = 0.28 + Math.random() * 0.18;
      p.startScale = 0.85 + Math.random() * 0.45;
      p.endScale = 0.05;
      p.gravity = -1.5;
      p.color.setHex(0xf4f1ea);
    }
  }

  public spawnSparkles(pos: THREE.Vector3, colorHex = 0xffdf4d, count = 8, speed = 4.5): void {
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      p.active = true;
      p.pos.copy(pos).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.8,
          (Math.random() - 0.5) * 0.8
        )
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.3) * Math.PI;
      p.vel.set(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 2.2,
        Math.sin(theta) * Math.cos(phi) * speed
      );
      p.age = 0;
      p.life = 0.38 + Math.random() * 0.26;
      p.startScale = 0.75 + Math.random() * 0.5;
      p.endScale = 0.02;
      p.gravity = -8.5;
      p.color.setHex(colorHex);
    }
  }

  public spawnShockRing(pos: THREE.Vector3, colorHex = 0xffe066, maxRadius = 4.5, life = 0.38): void {
    const geo = new THREE.RingGeometry(0.72, 1.0, 28);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y + 0.08, pos.z);
    mesh.scale.setScalar(0.2);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, age: 0, life, maxRadius });
  }

  public update(dt: number, phase: WorldPhase): void {
    let anyDirty = false;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyDirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.instanced.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.vel.y += p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      const t = p.age / p.life;
      const s = p.startScale + (p.endScale - p.startScale) * t;

      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.age * 6, p.age * 4, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.instanced.setMatrixAt(i, this.dummy.matrix);
      this.instanced.setColorAt(i, p.color);
    }

    if (anyDirty) {
      this.instanced.instanceMatrix.needsUpdate = true;
      if (this.instanced.instanceColor) {
        this.instanced.instanceColor.needsUpdate = true;
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = r.age / r.life;
      const radius = 0.3 + (r.maxRadius - 0.3) * (1 - Math.pow(1 - t, 2.2));
      r.mesh.scale.setScalar(radius);
      r.mat.opacity = (1 - t) * 0.9;
    }

    // Gentle drift of ambient motes
    this.ambientMat.color.lerp(
      new THREE.Color(phase === 'luna' ? 0x74f2ff : 0xffe47a),
      Math.min(1, dt * 4)
    );
    const posAttr = this.ambientMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.ambientCount; i++) {
      let y = posAttr.getY(i) + (phase === 'luna' ? 0.6 : -0.45) * dt;
      if (y > 48) y = 2;
      if (y < 2) y = 48;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
  }
}
