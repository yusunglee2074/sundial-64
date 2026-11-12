import * as THREE from 'three';
import { ParticleSystem } from '../graphics/ParticleSystem';
import { SoundEngine } from '../audio/SoundEngine';
import { Player } from './Player';
import { StarId, WorldPhase } from '../types';

export interface CoinItem {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  isRed: boolean;
  collected: boolean;
  beam?: THREE.Mesh;
}

export interface PowerStarItem {
  id: StarId;
  group: THREE.Group;
  starMesh: THREE.Mesh;
  haloMesh: THREE.Mesh;
  pos: THREE.Vector3;
  spawned: boolean;
  collected: boolean;
}

export interface Goombot {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  keyMesh: THREE.Mesh;
  cushionMesh: THREE.Mesh;
  zzzGroup: THREE.Group;
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  patrolRadius: number;
  angle: number;
  alive: boolean;
  respawnTimer: number;
}

export interface Signpost {
  pos: THREE.Vector3;
  title: string;
  body: string;
}

interface BossShockwave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  radius: number;
  maxRadius: number;
  center: THREE.Vector3;
  hitPlayer: boolean;
}

function createFivePointStarGeometry(outerR = 0.78, innerR = 0.38, depth = 0.30): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = -Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.08,
    bevelThickness: 0.09,
  });
  geo.center();
  return geo;
}

export class StageEntities {
  public coins: CoinItem[] = [];
  public stars = new Map<StarId, PowerStarItem>();
  public goombots: Goombot[] = [];
  public signs: Signpost[] = [];

  public coinCount = 0;
  public redCoinCount = 0;
  public collectedStars = new Set<StarId>();

  // Star #5 Chrono-Ring Time Trial
  private switchBasePos = new THREE.Vector3(-12, 2.0, 34);
  private switchTopMesh!: THREE.Mesh;
  public ringSprintActive = false;
  public ringSprintTimer = 0;
  public ringsCleared = 0;
  public readonly totalRings = 7;
  private ringObjects: { group: THREE.Group; pos: THREE.Vector3; cleared: boolean }[] = [];
  private tickSecondAccum = 0;

  // King Horologe Boss (Star #1)
  public bossGroup = new THREE.Group();
  private bossCoreMesh!: THREE.Mesh;
  private bossCoreHalo!: THREE.Mesh;
  private bossCrownMesh!: THREE.Mesh;
  private bossMinuteHand!: THREE.Mesh;
  private bossLeftArm!: THREE.Group;
  private bossRightArm!: THREE.Group;
  private bossLeftFoot!: THREE.Mesh;
  private bossRightFoot!: THREE.Mesh;
  public bossPos = new THREE.Vector3(0, 38.0, -30);
  private bossHome = new THREE.Vector3(0, 38.0, -30);
  public bossHp = 3;
  public bossMaxHp = 3;
  public bossDefeated = false;
  private bossState: 'patrol' | 'windup' | 'jump_slam' | 'recover_sol' | 'frozen_exposed' | 'hurt' = 'patrol';
  private bossTimer = 0;
  private bossJumpY = 0;
  private bossShockwaves: BossShockwave[] = [];

  // Shared geometries/materials
  private starGeo = createFivePointStarGeometry();
  private goldStarMat = new THREE.MeshStandardMaterial({
    color: 0xffd93b,
    emissive: 0x6b4800,
    metalness: 0.45,
    roughness: 0.2,
  });
  private ghostStarMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x1e3a8a,
    transparent: true,
    opacity: 0.34,
    roughness: 0.3,
  });
  private collectedStarMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    emissive: 0x1d4ed8,
    transparent: true,
    opacity: 0.52,
    roughness: 0.25,
  });

  // Event callbacks
  public onStarCollected?: (id: StarId) => void;
  public onStarSpawned?: (id: StarId, label: string) => void;
  public onBanner?: (text: string, color?: string) => void;
  public onNearbySign?: (sign: Signpost | null) => void;

  private radarVisible = false;

  constructor(
    private scene: THREE.Scene,
    private particles: ParticleSystem,
    private sound: SoundEngine
  ) {
    this.buildChronoSwitchAndRings();
    this.buildKingHorologe();
  }

  public setRadarVisible(vis: boolean): void {
    this.radarVisible = vis;
    for (const c of this.coins) {
      if (c.beam) {
        c.beam.visible = vis && !c.collected;
      }
    }
  }

  // ==================== SPAWN HELPERS ====================

  public addYellowCoin(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd43b,
      emissive: 0x4d3300,
      metalness: 0.55,
      roughness: 0.25,
    });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.11, 14), mat);
    coin.rotation.x = Math.PI / 2;
    group.add(coin);

    const slit = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.42, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
    );
    group.add(slit);

    this.scene.add(group);
    this.coins.push({
      mesh: group,
      pos: new THREE.Vector3(x, y, z),
      isRed: false,
      collected: false,
    });
  }

  public addCoinLine(from: THREE.Vector3, to: THREE.Vector3, count: number, arcHeight = 0): void {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.z, to.z, t);
      const y = THREE.MathUtils.lerp(from.y, to.y, t) + Math.sin(t * Math.PI) * arcHeight;
      this.addYellowCoin(x, y, z);
    }
  }

  public addCoinRing(cx: number, y: number, cz: number, radius: number, count = 8): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.addYellowCoin(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
    }
  }

  public addRedCoin(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const redMat = new THREE.MeshStandardMaterial({
      color: 0xff2a4b,
      emissive: 0x690818,
      metalness: 0.5,
      roughness: 0.18,
    });
    const oct = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.14, 8), redMat);
    oct.rotation.x = Math.PI / 2;
    group.add(oct);

    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color: 0xffb3c1 })
    );
    gem.scale.set(1, 1.4, 0.7);
    group.add(gem);

    // Optional Twilight Surveyor Vertical Starlight Beam ([Tab])
    const beamGeo = new THREE.CylinderGeometry(0.16, 0.42, 36, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff4d6d,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(x, y + 18, z);
    beam.visible = false;
    this.scene.add(beam);

    this.scene.add(group);
    this.coins.push({
      mesh: group,
      pos: new THREE.Vector3(x, y, z),
      isRed: true,
      collected: false,
      beam,
    });
  }

  public registerPowerStar(id: StarId, x: number, y: number, z: number, initiallySpawned: boolean): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const starMesh = new THREE.Mesh(
      this.starGeo,
      initiallySpawned ? this.goldStarMat : this.ghostStarMat
    );
    group.add(starMesh);

    // Cute N64 vertical eyes on front face (no double-through ghosting!)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
    for (const sx of [-0.14, 0.14]) {
      const eyeF = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.21, 0.04), eyeMat);
      eyeF.position.set(sx, 0.06, 0.245);
      starMesh.add(eyeF);
    }

    const haloMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.16, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffe566,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: initiallySpawned ? 0.65 : 0.15,
      })
    );
    group.add(haloMesh);

    this.scene.add(group);
    this.stars.set(id, {
      id,
      group,
      starMesh,
      haloMesh,
      pos: new THREE.Vector3(x, y, z),
      spawned: initiallySpawned,
      collected: false,
    });
  }

  public spawnStar(id: StarId, bannerTitle: string): void {
    const item = this.stars.get(id);
    if (!item || item.spawned) return;
    item.spawned = true;
    item.starMesh.material = this.goldStarMat;
    (item.haloMesh.material as THREE.MeshBasicMaterial).opacity = 0.72;
    this.sound.playStarAppear();
    this.particles.spawnShockRing(item.pos, 0xffe066, 5.5, 0.55);
    this.particles.spawnSparkles(item.pos, 0xffdf40, 24, 6.5);
    this.onStarSpawned?.(id, bannerTitle);
  }

  public addGoombot(x: number, y: number, z: number, patrolRadius = 3.5): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.45, metalness: 0.35 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.65 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x111827 });

    const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), bronzeMat);
    bodyMesh.scale.set(1.05, 0.92, 1.05);
    bodyMesh.position.y = 0.58;
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Feet
    for (const sx of [-0.28, 0.28]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.42), darkMat);
      foot.position.set(sx, 0.1, 0.08);
      group.add(foot);
    }

    // Angry N64 Goomba eyes
    for (const sx of [-0.19, 0.19]) {
      const ew = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), eyeMat);
      ew.position.set(sx, 0.66, 0.54);
      group.add(ew);
      const ep = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), darkMat);
      ep.position.set(sx, 0.66, 0.62);
      group.add(ep);
    }

    // Wind-up Clockwork Key on top!
    const keyMesh = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 12), brassMat);
    keyMesh.position.set(0, 1.24, 0);
    group.add(keyMesh);

    // Luna Sleep Bounce Cushion (visible in Luna!)
    const cushionMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.76, 0.68, 0.34, 14),
      new THREE.MeshStandardMaterial({
        color: 0xc084fc,
        emissive: 0x4c1d95,
        roughness: 0.3,
      })
    );
    cushionMesh.position.y = 0.96;
    cushionMesh.visible = false;
    group.add(cushionMesh);

    // Floating Zzz spheres
    const zzzGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + i * 0.03, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe9d5ff })
      );
      orb.position.set(0.25 + i * 0.16, 1.35 + i * 0.26, 0);
      zzzGroup.add(orb);
    }
    zzzGroup.visible = false;
    group.add(zzzGroup);

    this.scene.add(group);
    this.goombots.push({
      group,
      bodyMesh,
      keyMesh,
      cushionMesh,
      zzzGroup,
      homePos: new THREE.Vector3(x, y, z),
      pos: new THREE.Vector3(x, y, z),
      patrolRadius,
      angle: Math.random() * Math.PI * 2,
      alive: true,
      respawnTimer: 0,
    });
  }

  public addSignpost(x: number, y: number, z: number, rotY: number, title: string, body: string): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.7 });
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.6 });

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 1.2, 8), woodMat);
    post.position.y = 0.6;
    g.add(post);

    const board = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 0.14), boardMat);
    board.position.y = 1.25;
    board.castShadow = true;
    g.add(board);

    this.scene.add(g);
    this.signs.push({
      pos: new THREE.Vector3(x, y, z),
      title,
      body,
    });
  }

  // ==================== STAR #5 CHRONO SWITCH & RINGS ====================

  private buildChronoSwitchAndRings(): void {
    const swGroup = new THREE.Group();
    swGroup.position.copy(this.switchBasePos);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.25, 1.4, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.5, roughness: 0.4 })
    );
    base.position.y = 0.11;
    swGroup.add(base);

    this.switchTopMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.98, 1.08, 0.36, 8),
      new THREE.MeshStandardMaterial({
        color: 0x2563eb,
        emissive: 0x1d4ed8,
        roughness: 0.25,
      })
    );
    this.switchTopMesh.position.y = 0.34;
    swGroup.add(this.switchTopMesh);

    this.scene.add(swGroup);

    // 7 Golden Chrono-Rings guiding an exhilarating parkour loop from Plaza to Belltower Balcony!
    const ringCoords: [number, number, number][] = [
      [-6, 4.4, 26],   // 1: Plaza Sundial leap
      [4, 6.2, 17],    // 2: Mountain Trail Archway
      [15, 7.6, 13],   // 3: Lower Terraced Step
      [25, 10.6, 10],  // 4: Dual-Phase Approach
      [31, 14.5, 6],   // 5: Belltower Lower Ramp
      [35, 18.2, -1],  // 6: Belltower Upper Rise
      [34, 21.8, -8],  // 7: Belltower Balcony Finish!
    ];

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0x854d0e,
      metalness: 0.65,
      roughness: 0.2,
    });

    for (const [rx, ry, rz] of ringCoords) {
      const rg = new THREE.Group();
      rg.position.set(rx, ry, rz);
      const torus = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.14, 10, 24), ringMat);
      rg.add(torus);
      rg.visible = false;
      this.scene.add(rg);
      this.ringObjects.push({
        group: rg,
        pos: new THREE.Vector3(rx, ry, rz),
        cleared: false,
      });
    }
  }

  public handleGroundPoundAt(pos: THREE.Vector3, phase: WorldPhase): void {
    // 1. Check Blue Chrono Switch in Sundial Plaza
    const distSwitch = Math.hypot(pos.x - this.switchBasePos.x, pos.z - this.switchBasePos.z);
    if (distSwitch < 1.85 && Math.abs(pos.y - this.switchBasePos.y) < 1.5) {
      const star5 = this.stars.get(5);
      if (star5 && !star5.spawned && !this.ringSprintActive) {
        this.startRingSprint();
      }
    }

    // 2. Check King Horologe Exposed Astral Core!
    if (!this.bossDefeated && this.bossState === 'frozen_exposed' && phase === 'luna') {
      const coreWorld = new THREE.Vector3();
      this.bossCoreMesh.getWorldPosition(coreWorld);
      const dXZ = Math.hypot(pos.x - coreWorld.x, pos.z - coreWorld.z);
      const dY = Math.abs(pos.y - coreWorld.y);
      if (dXZ < 3.4 && dY < 4.2) {
        this.damageBoss();
      }
    }
  }

  private startRingSprint(): void {
    this.ringSprintActive = true;
    this.ringSprintTimer = 36.0;
    this.ringsCleared = 0;
    this.tickSecondAccum = 0;
    this.switchTopMesh.position.y = 0.16;
    this.sound.playSwitchPress();

    for (const r of this.ringObjects) {
      r.cleared = false;
      r.group.visible = true;
      r.group.scale.setScalar(1);
    }
    this.onBanner?.('시간고리 달리기! 황금 고리 7개를 모두 통과하세요!', '#60a5fa');
  }

  // ==================== 시계왕 호롤로지 (SUMMIT BOSS) ====================

  private buildKingHorologe(): void {
    this.bossGroup.position.copy(this.bossPos);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.65 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.25 });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4 });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0891b2,
      roughness: 0.15,
      metalness: 0.3,
    });

    // Broad armored stone torso
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.1, 2.1), stoneMat);
    body.position.y = 2.15;
    body.castShadow = true;
    this.bossGroup.add(body);

    // Brass shoulder trims
    const trim = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.45, 2.3), brassMat);
    trim.position.y = 3.55;
    this.bossGroup.add(trim);

    // Giant Clockface on Chest
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.16, 20), faceMat);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 2.3, 1.06);
    this.bossGroup.add(dial);

    this.bossMinuteHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.72, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x1e293b })
    );
    this.bossMinuteHand.position.set(0, 2.3, 1.16);
    this.bossGroup.add(this.bossMinuteHand);

    // Fierce Glowing Eyes above dial
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    for (const sx of [-0.52, 0.52]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.12), eyeMat);
      eye.position.set(sx, 3.32, 1.06);
      eye.rotation.z = sx < 0 ? -0.22 : 0.22;
      this.bossGroup.add(eye);
    }

    // Royal Brass Crown
    this.bossCrownMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.72, 0.75, 6), brassMat);
    this.bossCrownMesh.position.y = 4.12;
    this.bossGroup.add(this.bossCrownMesh);

    // Glowing Astral Gear Core on Back (Weak Point when frozen in Luna!)
    this.bossCoreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.48, 12), coreMat);
    this.bossCoreMesh.rotation.x = Math.PI / 2;
    this.bossCoreMesh.position.set(0, 2.2, -1.18);
    this.bossGroup.add(this.bossCoreMesh);

    this.bossCoreHalo = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.38, 16),
      new THREE.MeshBasicMaterial({
        color: 0x67e8f9,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      })
    );
    this.bossCoreHalo.position.set(0, 2.2, -1.44);
    this.bossGroup.add(this.bossCoreHalo);

    // Articulated Heavy Stone & Brass Slam Arms!
    const makeBossArm = (side: -1 | 1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 1.78, 3.15, 0.15);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.35, 0.68), stoneMat);
      upper.position.y = -0.55;
      g.add(upper);
      const fist = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.85, 0.95), brassMat);
      fist.position.set(0, -1.35, 0.12);
      fist.castShadow = true;
      g.add(fist);
      this.bossGroup.add(g);
      return g;
    };
    this.bossLeftArm = makeBossArm(-1);
    this.bossRightArm = makeBossArm(1);

    // Chunky Feet
    this.bossLeftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 1.3), brassMat);
    this.bossLeftFoot.position.set(-0.78, 0.3, 0.15);
    this.bossGroup.add(this.bossLeftFoot);

    this.bossRightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 1.3), brassMat);
    this.bossRightFoot.position.set(0.78, 0.3, 0.15);
    this.bossGroup.add(this.bossRightFoot);

    this.scene.add(this.bossGroup);
  }

  private damageBoss(): void {
    this.bossHp--;
    this.sound.playBossHit();
    this.particles.spawnShockRing(this.bossPos.clone().add(new THREE.Vector3(0, 1.5, 0)), 0x22d3ee, 7.5, 0.45);
    this.particles.spawnSparkles(this.bossPos.clone().add(new THREE.Vector3(0, 2.5, 0)), 0xffd43b, 26, 7);

    if (this.bossHp <= 0) {
      this.bossDefeated = true;
      this.bossGroup.visible = false;
      // Shower of celebratory coins!
      this.addCoinRing(this.bossHome.x, this.bossHome.y + 0.9, this.bossHome.z, 3.8, 8);
      this.spawnStar(1, '시계왕을 쓰러뜨렸습니다! ★ 왕관의 별 등장!');
    } else {
      this.bossState = 'hurt';
      this.bossTimer = 1.1;
      this.bossGroup.rotation.x = 0;
      this.onBanner?.(
        `시계왕의 핵에 명중! (앞으로 ${this.bossHp}번!)`,
        '#22d3ee'
      );
    }
  }

  private spawnBossShockwave(): void {
    const geo = new THREE.RingGeometry(0.86, 1.0, 36);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.bossPos.x, this.bossHome.y + 0.22, this.bossPos.z);
    this.scene.add(mesh);
    this.bossShockwaves.push({
      mesh,
      mat,
      radius: 1.2,
      maxRadius: 15.5,
      center: new THREE.Vector3(this.bossPos.x, this.bossHome.y, this.bossPos.z),
      hitPlayer: false,
    });
  }

  // ==================== FRAME UPDATE ====================

  public update(dt: number, player: Player, phase: WorldPhase): void {
    const now = performance.now() * 0.001;

    // 1. Coins & Red Coins
    for (const c of this.coins) {
      if (c.collected) continue;
      c.mesh.rotation.y += dt * (c.isRed ? 3.4 : 2.6);
      c.mesh.position.y = c.pos.y + Math.sin(now * 3 + c.pos.x) * 0.12;

      const d = player.pos.clone().add(new THREE.Vector3(0, 0.85, 0)).distanceTo(c.mesh.position);
      if (d < 1.25) {
        c.collected = true;
        c.mesh.visible = false;
        if (c.beam) c.beam.visible = false;

        if (c.isRed) {
          this.coinCount += 2;
          this.redCoinCount++;
          player.heal(2);
          this.sound.playRedCoin(this.redCoinCount);
          this.particles.spawnSparkles(c.pos, 0xff3b5c, 14, 5.2);
          this.onBanner?.(`빨간 동전 ${this.redCoinCount} / 8!`, '#ff4d6d');

          if (this.redCoinCount === 8) {
            this.spawnStar(3, '빨간 동전 8개 완성! ★ 광장에 별이 나타났습니다!');
          }
        } else {
          this.coinCount += 1;
          player.heal(1);
          this.sound.playCoin();
          this.particles.spawnSparkles(c.pos, 0xffe066, 7, 3.8);
        }
      }
    }

    // 2. Power Stars
    for (const s of this.stars.values()) {
      s.starMesh.rotation.y += dt * 2.2;
      s.haloMesh.rotation.z -= dt * 1.4;
      s.group.position.y = s.pos.y + Math.sin(now * 2.6 + s.id) * 0.22;

      if (s.spawned && player.state !== 'star_dance') {
        const d = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(s.group.position);
        if (d < 1.55 && !s.collected) {
          s.collected = true;
          this.collectedStars.add(s.id);
          s.starMesh.material = this.collectedStarMat;
          (s.haloMesh.material as THREE.MeshBasicMaterial).color.setHex(0x60a5fa);
          this.sound.playStarGet();
          player.enterStarDance();
          this.onStarCollected?.(s.id);
        }
      }
    }

    // 3. Goombots (Chase in Sol <-> Sleepy Bounce-Pads in Luna!)
    for (const g of this.goombots) {
      if (!g.alive) {
        g.respawnTimer -= dt;
        if (g.respawnTimer <= 0) {
          g.alive = true;
          g.pos.copy(g.homePos);
          g.group.position.copy(g.pos);
          g.group.visible = true;
        }
        continue;
      }

      const isLuna = phase === 'luna';
      g.cushionMesh.visible = isLuna;
      g.zzzGroup.visible = isLuna;

      if (isLuna) {
        // Snoring purple spring cushion!
        g.bodyMesh.scale.set(1.12, 0.82 + Math.sin(now * 3.5) * 0.06, 1.12);
        g.zzzGroup.position.y = Math.sin(now * 2.5) * 0.14;
      } else {
        // Active Sol patrolling / light chasing!
        g.keyMesh.rotation.z += dt * 7;
        g.bodyMesh.scale.set(1.05, 0.92 + Math.abs(Math.sin(now * 9)) * 0.08, 1.05);

        const toPlayer = new THREE.Vector3().subVectors(player.pos, g.pos);
        toPlayer.y = 0;
        const distFromHome = Math.hypot(player.pos.x - g.homePos.x, player.pos.z - g.homePos.z);

        if (toPlayer.length() < 7.5 && distFromHome < g.patrolRadius + 4.0 && Math.abs(player.pos.y - g.pos.y) < 3) {
          toPlayer.normalize();
          g.pos.x += toPlayer.x * 3.6 * dt;
          g.pos.z += toPlayer.z * 3.6 * dt;
          g.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
        } else {
          g.angle += dt * 1.1;
          const tx = g.homePos.x + Math.cos(g.angle) * g.patrolRadius;
          const tz = g.homePos.z + Math.sin(g.angle) * g.patrolRadius;
          const dx = tx - g.pos.x;
          const dz = tz - g.pos.z;
          g.pos.x += dx * 2.2 * dt;
          g.pos.z += dz * 2.2 * dt;
          g.group.rotation.y = Math.atan2(dx, dz);
        }
        g.group.position.copy(g.pos);
      }

      // Player interaction check
      const horizD = Math.hypot(player.pos.x - g.pos.x, player.pos.z - g.pos.z);
      const dy = player.pos.y - g.pos.y;

      if (horizD < 1.18 && dy > -0.4 && dy < 1.55) {
        if (isLuna) {
          // Spring cushion bounce!
          if (player.vel.y <= 2.0) {
            player.bounceUp(24.5, '잠든 태엽버섯 스프링 점프!');
          }
        } else {
          const playerAttacking =
            player.vel.y < -1.5 ||
            dy > 0.62 ||
            player.state === 'dive' ||
            player.state === 'diveslide' ||
            player.state === 'groundpound_fall';

          if (playerAttacking) {
            g.alive = false;
            g.respawnTimer = 15.0;
            g.group.visible = false;
            this.sound.playEnemyDefeat();
            this.particles.spawnSparkles(g.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffd43b, 12, 5);
            this.coinCount += 1;
            player.heal(1);
            if (player.state !== 'groundpound_fall' && player.state !== 'diveslide') {
              player.vel.y = 14.2;
            }
          } else {
            player.takeDamage(1, g.pos);
          }
        }
      }
    }

    // 4. Star #5 Chrono-Ring Time Trial
    if (this.ringSprintActive) {
      this.ringSprintTimer -= dt;
      this.tickSecondAccum += dt;
      if (this.tickSecondAccum >= 1.0) {
        this.tickSecondAccum -= 1.0;
        this.sound.playTick(this.ringSprintTimer < 8);
      }

      for (let i = 0; i < this.ringObjects.length; i++) {
        const r = this.ringObjects[i];
        if (r.cleared) continue;
        r.group.rotation.y += dt * 2.4;

        const d = player.pos.clone().add(new THREE.Vector3(0, 0.9, 0)).distanceTo(r.pos);
        if (d < 2.15) {
          r.cleared = true;
          r.group.visible = false;
          this.ringsCleared++;
          this.sound.playRing(this.ringsCleared);
          this.particles.spawnSparkles(r.pos, 0xfacc15, 14, 5.5);

          if (this.ringsCleared >= this.totalRings) {
            this.ringSprintActive = false;
            this.spawnStar(5, '시간고리 도전 성공! ★ 종탑에 별 등장!');
          } else {
            this.onBanner?.(`시간고리 ${this.ringsCleared} / ${this.totalRings}!`, '#fde047');
          }
        }
      }

      if (this.ringSprintActive && this.ringSprintTimer <= 0) {
        this.ringSprintActive = false;
        this.switchTopMesh.position.y = 0.34;
        for (const r of this.ringObjects) r.group.visible = false;
        this.onBanner?.("시간 초과! 파란 스위치를 다시 찍으면 재도전!", '#f87171');
      }
    }

    // 5. Signpost proximity check
    let activeSign: Signpost | null = null;
    for (const s of this.signs) {
      if (player.pos.distanceTo(s.pos) < 3.4) {
        activeSign = s;
        break;
      }
    }
    this.onNearbySign?.(activeSign);

    // 6. King Horologe Summit Boss AI
    this.updateKingHorologe(dt, player, phase, now);
  }

  private updateKingHorologe(dt: number, player: Player, phase: WorldPhase, now: number): void {
    // Update shockwaves even if boss state changes
    for (let i = this.bossShockwaves.length - 1; i >= 0; i--) {
      const sw = this.bossShockwaves[i];
      const speed = phase === 'luna' ? 4.2 : 12.5; // Shockwaves slow down dramatically in Luna!
      sw.radius += speed * dt;
      sw.mesh.scale.setScalar(sw.radius);
      sw.mat.opacity = Math.max(0, 1 - sw.radius / sw.maxRadius);

      if (!sw.hitPlayer) {
        const dPlayer = Math.hypot(player.pos.x - sw.center.x, player.pos.z - sw.center.z);
        if (Math.abs(dPlayer - sw.radius) < 0.78 && Math.abs(player.pos.y - sw.center.y) < 1.15) {
          sw.hitPlayer = true;
          player.takeDamage(1, sw.center);
        }
      }

      if (sw.radius >= sw.maxRadius) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mat.dispose();
        this.bossShockwaves.splice(i, 1);
      }
    }

    if (this.bossDefeated) return;

    const distToArena = Math.hypot(player.pos.x - this.bossHome.x, player.pos.z - this.bossHome.z);
    const playerInArena = distToArena < 21 && player.pos.y > 34;

    const coreMat = this.bossCoreMesh.material as THREE.MeshStandardMaterial;
    const tempo = 1 + (3 - this.bossHp) * 0.25;

    if (this.bossState === 'hurt') {
      this.bossTimer -= dt;
      this.bossGroup.rotation.y += dt * 10;
      if (this.bossTimer <= 0) {
        this.bossState = 'patrol';
        this.bossTimer = 1.6;
      }
      return;
    }

    // If boss slammed in Sol and player shifts to Luna -> FREEZE HIS CLOCKWORK CORE EXPOSED!
    if (this.bossState === 'recover_sol' && phase === 'luna') {
      this.bossState = 'frozen_exposed';
      this.bossTimer = 5.5;
      this.particles.spawnShockRing(this.bossPos, 0x22d3ee, 5.2, 0.4);
      this.onBanner?.('톱니가 얼었습니다! 빛나는 핵을 엉덩이 찍기로 공격하세요!', '#22d3ee');
    }

    if (this.bossState === 'frozen_exposed') {
      if (phase === 'sol') {
        // Unfroze early!
        this.bossState = 'patrol';
        this.bossGroup.rotation.x = 0;
      } else {
        this.bossTimer -= dt;
        // Bowed forward so player can easily hop above & 엉덩이 찍기 his core!
        this.bossGroup.rotation.x = THREE.MathUtils.lerp(this.bossGroup.rotation.x, 1.18, Math.min(1, dt * 10));
        this.bossCoreMesh.rotation.y += dt * 4;
        this.bossCoreHalo.rotation.z -= dt * 3;
        (this.bossCoreHalo.material as THREE.MeshBasicMaterial).opacity = 0.95;
        coreMat.emissive.setHex(0x22d3ee);
        coreMat.emissiveIntensity = 1.6 + Math.sin(now * 12) * 0.5;
        if (this.bossTimer <= 0) {
          this.bossState = 'patrol';
          this.bossGroup.rotation.x = 0;
        }
      }
      return;
    }

    (this.bossCoreHalo.material as THREE.MeshBasicMaterial).opacity = 0.35;
    coreMat.emissive.setHex(0x0891b2);
    coreMat.emissiveIntensity = 0.4;
    this.bossGroup.rotation.x = THREE.MathUtils.lerp(this.bossGroup.rotation.x, 0, Math.min(1, dt * 8));
    this.bossLeftArm.rotation.x = THREE.MathUtils.lerp(this.bossLeftArm.rotation.x, 0, Math.min(1, dt * 8));
    this.bossRightArm.rotation.x = THREE.MathUtils.lerp(this.bossRightArm.rotation.x, 0, Math.min(1, dt * 8));

    if (!playerInArena) {
      // Idle guard at Crown Arena
      this.bossMinuteHand.rotation.z -= dt * 1.5;
      return;
    }

    // Tick hands in Sol, slow crawl in Luna
    const phaseTimeScale = phase === 'luna' ? 0.3 : 1.0;
    this.bossMinuteHand.rotation.z -= dt * 4.5 * tempo * phaseTimeScale;

    if (this.bossState === 'patrol') {
      this.bossTimer -= dt * tempo * phaseTimeScale;
      const toPlayer = new THREE.Vector3(player.pos.x - this.bossPos.x, 0, player.pos.z - this.bossPos.z);
      if (toPlayer.length() > 0.2) {
        toPlayer.normalize();
        const moveSpd = 3.8 * tempo * phaseTimeScale;
        this.bossPos.x += toPlayer.x * moveSpd * dt;
        this.bossPos.z += toPlayer.z * moveSpd * dt;
        // Keep inside Crown Arena radius 13
        const offX = this.bossPos.x - this.bossHome.x;
        const offZ = this.bossPos.z - this.bossHome.z;
        const offD = Math.hypot(offX, offZ);
        if (offD > 12.5) {
          this.bossPos.x = this.bossHome.x + (offX / offD) * 12.5;
          this.bossPos.z = this.bossHome.z + (offZ / offD) * 12.5;
        }
        this.bossGroup.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      }

      // Marching feet
      const stride = Math.sin(now * 7 * tempo * phaseTimeScale) * 0.35;
      this.bossLeftFoot.position.z = 0.15 + stride;
      this.bossRightFoot.position.z = 0.15 - stride;

      if (this.bossTimer <= 0) {
        this.bossState = 'windup';
        this.bossTimer = 0.72;
      }
    } else if (this.bossState === 'windup') {
      this.bossTimer -= dt * tempo;
      this.bossGroup.scale.set(1.12, 0.84, 1.12);
      this.bossLeftArm.rotation.x = -2.4;
      this.bossRightArm.rotation.x = -2.4;
      if (this.bossTimer <= 0) {
        this.bossGroup.scale.set(1, 1, 1);
        this.bossState = 'jump_slam';
        this.bossTimer = 0.68;
      }
    } else if (this.bossState === 'jump_slam') {
      this.bossTimer -= dt * tempo;
      const t = 1 - Math.max(0, this.bossTimer / 0.68);
      this.bossJumpY = Math.sin(t * Math.PI) * 5.2;
      this.bossLeftArm.rotation.x = -2.4 + t * 3.2;
      this.bossRightArm.rotation.x = -2.4 + t * 3.2;
      if (this.bossTimer <= 0) {
        this.bossJumpY = 0;
        this.sound.playBossSlam();
        this.spawnBossShockwave();
        this.particles.spawnDust(this.bossPos, 16, 3.8);
        if (phase === 'luna') {
          this.bossState = 'frozen_exposed';
          this.bossTimer = 5.5;
          this.onBanner?.('톱니가 얼었습니다! 빛나는 핵을 엉덩이 찍기로 공격하세요!', '#22d3ee');
        } else {
          this.bossState = 'recover_sol';
          this.bossTimer = 3.2;
          this.onBanner?.('지금 [F]로 밤으로 전환해 톱니를 얼리세요!', '#fcd34d');
        }
      }
    } else if (this.bossState === 'recover_sol') {
      this.bossTimer -= dt;
      this.bossGroup.rotation.x = 0.55;
      if (this.bossTimer <= 0) {
        this.bossState = 'patrol';
        this.bossTimer = 2.4;
      }
    }

    this.bossGroup.position.set(this.bossPos.x, this.bossHome.y + this.bossJumpY, this.bossPos.z);

    // Body bump check if boss isn't bowed/frozen
    if (this.bossState === 'patrol' || this.bossState === 'jump_slam') {
      const bodyD = Math.hypot(player.pos.x - this.bossPos.x, player.pos.z - this.bossPos.z);
      if (bodyD < 1.85 && player.pos.y < this.bossHome.y + this.bossJumpY + 3.4) {
        player.takeDamage(1, this.bossPos);
      }
    }
  }
}
