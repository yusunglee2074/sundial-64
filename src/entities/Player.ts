import * as THREE from 'three';
import { CollisionWorld, DynamicBody } from '../physics/CollisionWorld';
import { ParticleSystem } from '../graphics/ParticleSystem';
import { SoundEngine } from '../audio/SoundEngine';
import { MoveState, SurfaceType, WorldPhase } from '../types';

export interface InputState {
  moveX: number; // -1..1
  moveZ: number; // -1..1
  jumpPressed: boolean;
  jumpHeld: boolean;
  crouchHeld: boolean;
  crouchPressed: boolean;
  divePressed: boolean;
  echoPressed: boolean;
}

export class Player {
  public readonly root = new THREE.Group();
  private visualRig = new THREE.Group();

  // Articulated N64 Hero parts ("Chrono-Courier Pip")
  private torso!: THREE.Group;
  private headGroup!: THREE.Group;
  private capVisor!: THREE.Mesh;
  private leftArm!: THREE.Group;
  private rightArm!: THREE.Group;
  private leftLeg!: THREE.Group;
  private rightLeg!: THREE.Group;
  private capeClockGear!: THREE.Mesh;
  private dropShadow!: THREE.Mesh;
  private shadowMat!: THREE.MeshBasicMaterial;

  // Physics state
  public pos = new THREE.Vector3(0, 2.2, 46.5);
  public vel = new THREE.Vector3(0, 0, 0);
  public facingYaw = Math.PI; // Facing -Z (into the island)
  public grounded = false;
  public currentSurface: SurfaceType = 'stone';
  public state: MoveState = 'idle';

  public health = 8;
  public readonly maxHealth = 8;
  public invulnTimer = 0;

  // Acrobatic Chrono-Flow Combo Chain
  public flowCombo = 0;
  private flowTimer = 0;
  private lastFlowMove = '';

  // SM64 Acrobatic Timers & Chains
  private jumpCombo = 0; // 0, 1, 2 -> next is 3단 점프!
  private comboResetTimer = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private stateTimer = 0;
  private groundPoundLandTimer = 0;

  // Wall Slide / 벽차기
  private wallNormal = new THREE.Vector3();
  private wallCoyoteTimer = 0;

  // Animation & Visual Polish
  private runCycle = 0;
  private stepSoundTimer = 0;
  private flipPitch = 0;
  private spinYaw = 0;
  private squash = new THREE.Vector3(1, 1, 1);
  private standingBody: DynamicBody | null = null;
  private platformDelta = new THREE.Vector3();

  // Safe checkpoint for void rescue
  public lastSafePos = new THREE.Vector3(0, 2.5, 46.5);

  // 시간의 잔상 Statue [R]
  private echoGroup: THREE.Group | null = null;
  private echoColliderMesh: THREE.Mesh | null = null;
  private echoTimer = 0;
  private airEchoAvailable = true;

  // Callbacks to game HUD / World events
  public onMoveBanner?: (label: string, accent?: string) => void;
  public onGroundPoundImpact?: (pos: THREE.Vector3) => void;

  private readonly radius = 0.50;
  private readonly height = 1.72;
  private readonly maxRunSpeed = 12.6;
  private readonly gravity = -38.0;

  constructor(
    private scene: THREE.Scene,
    private collision: CollisionWorld,
    private particles: ParticleSystem,
    private sound: SoundEngine
  ) {
    this.buildCharacterMesh();
    this.buildDropShadow();
    this.root.position.copy(this.pos);
    this.scene.add(this.root);
  }

  private buildCharacterMesh(): void {
    this.root.add(this.visualRig);

    const redMat = new THREE.MeshStandardMaterial({ color: 0xe83338, roughness: 0.45 });
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x2558d9, roughness: 0.55 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffcca6, roughness: 0.6 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0xfafcff, roughness: 0.4 });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x6e3b1e, roughness: 0.65 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffca3a,
      metalness: 0.6,
      roughness: 0.28,
      emissive: 0x3a2400,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e2230, roughness: 0.4 });

    this.torso = new THREE.Group();
    this.torso.position.y = 0.72;
    this.visualRig.add(this.torso);

    // Overalls body
    const bodyMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.28, 6, 12), blueMat);
    bodyMesh.castShadow = true;
    this.torso.add(bodyMesh);

    // Red shirt chest band
    const shirtMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.31, 0.24, 12), redMat);
    shirtMesh.position.y = 0.14;
    this.torso.add(shirtMesh);

    // Two classic yellow overall buttons
    for (const sx of [-0.13, 0.13]) {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10), goldMat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(sx, 0.08, 0.31);
      this.torso.add(btn);
    }

    // Golden Clockwork Wind-up Key / Gear Emblem on back!
    this.capeClockGear = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.045, 8, 12), goldMat);
    this.capeClockGear.position.set(0, 0.12, -0.34);
    this.torso.add(this.capeClockGear);

    // Head
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 0.54;
    this.torso.add(this.headGroup);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 12), skinMat);
    headMesh.castShadow = true;
    this.headGroup.add(headMesh);

    // Chunky N64 nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), skinMat);
    nose.position.set(0, -0.02, 0.32);
    this.headGroup.add(nose);

    // Expressive eyes
    for (const sx of [-0.11, 0.11]) {
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.072, 8, 8), gloveMat);
      eyeWhite.scale.set(0.85, 1.2, 0.5);
      eyeWhite.position.set(sx, 0.06, 0.28);
      this.headGroup.add(eyeWhite);

      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), darkMat);
      pupil.scale.set(0.85, 1.15, 0.5);
      pupil.position.set(sx, 0.06, 0.315);
      this.headGroup.add(pupil);
    }

    // Iconic Red Cap + Gold Sundial Badge
    const capDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.355, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
      redMat
    );
    capDome.position.y = 0.04;
    capDome.rotation.x = -0.14;
    capDome.castShadow = true;
    this.headGroup.add(capDome);

    this.capVisor = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 12, 1, false, -Math.PI * 0.42, Math.PI * 0.84), redMat);
    this.capVisor.position.set(0, 0.11, 0.14);
    this.capVisor.rotation.x = 0.18;
    this.headGroup.add(this.capVisor);

    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.095, 12), goldMat);
    badge.position.set(0, 0.22, 0.335);
    badge.rotation.x = -0.22;
    this.headGroup.add(badge);

    // Arms + Big White Gloves
    const makeArm = (side: -1 | 1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 0.38, 0.20, 0);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.18, 5, 8), redMat);
      sleeve.position.y = -0.12;
      g.add(sleeve);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 10), gloveMat);
      glove.position.y = -0.29;
      glove.castShadow = true;
      g.add(glove);
      this.torso.add(g);
      return g;
    };
    this.leftArm = makeArm(-1);
    this.rightArm = makeArm(1);

    // Legs + Chunky Brown Boots
    const makeLeg = (side: -1 | 1): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(side * 0.16, 0.44, 0);
      const pant = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.10, 0.24, 8), blueMat);
      pant.position.y = -0.14;
      g.add(pant);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.19, 0.34), bootMat);
      boot.position.set(0, -0.33, 0.05);
      boot.castShadow = true;
      g.add(boot);
      this.visualRig.add(g);
      return g;
    };
    this.leftLeg = makeLeg(-1);
    this.rightLeg = makeLeg(1);
  }

  private buildDropShadow(): void {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    grad.addColorStop(0.65, 'rgba(0, 0, 0, 0.32)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(1.5, 1.5);
    geo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.dropShadow = new THREE.Mesh(geo, this.shadowMat);
    this.scene.add(this.dropShadow);
  }

  public spawnChronoEcho(): void {
    if (!this.grounded && !this.airEchoAvailable) {
      this.onMoveBanner?.('착지하면 잔상을 다시 사용할 수 있습니다', '#94a3b8');
      return;
    }

    // Clear previous Echo if active
    this.clearChronoEcho();

    const group = new THREE.Group();
    const isAir = !this.grounded;
    if (isAir) {
      this.airEchoAvailable = false;
    }

    // Position: If airborne, crystallize a solid platform directly beneath feet!
    // If grounded, place a sculpted Chrono-Pillar slightly ahead for stepping / wall-kicking!
    const spawnPos = new THREE.Vector3();
    const pillarHeight = isAir ? 1.4 : 2.6;
    const pillarWidth = 2.3;

    if (isAir) {
      spawnPos.set(this.pos.x, this.pos.y - pillarHeight * 0.5 - 0.04, this.pos.z);
    } else {
      spawnPos.set(
        this.pos.x + Math.sin(this.facingYaw) * 2.35,
        this.pos.y + pillarHeight * 0.5,
        this.pos.z + Math.cos(this.facingYaw) * 2.35
      );
    }

    group.position.copy(spawnPos);

    const echoMat = new THREE.MeshStandardMaterial({
      color: 0x5bf0ff,
      emissive: 0x1b6ca8,
      metalness: 0.4,
      roughness: 0.18,
      transparent: true,
      opacity: 0.78,
    });
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
    });

    const colGeo = new THREE.BoxGeometry(pillarWidth, pillarHeight, pillarWidth);
    const colMesh = new THREE.Mesh(colGeo, echoMat);
    group.add(colMesh);

    const wireMesh = new THREE.Mesh(colGeo, rimMat);
    wireMesh.scale.setScalar(1.02);
    group.add(wireMesh);

    // Holographic miniature silhouette of hero on top
    const miniStatue = new THREE.Mesh(
      new THREE.ConeGeometry(0.38, 0.85, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.55 })
    );
    miniStatue.position.y = pillarHeight * 0.5 + 0.45;
    group.add(miniStatue);

    this.scene.add(group);
    group.updateWorldMatrix(true, true);

    this.collision.addDynamicMesh('chrono_echo', colMesh, 'both', 'astral', 'echo');
    this.echoGroup = group;
    this.echoColliderMesh = colMesh;
    this.echoTimer = 9.0;

    this.sound.playEchoSpawn();
    this.particles.spawnShockRing(
      new THREE.Vector3(spawnPos.x, spawnPos.y + pillarHeight * 0.5, spawnPos.z),
      0x5bf0ff,
      3.4,
      0.35
    );
    this.particles.spawnSparkles(spawnPos, 0x70f5ff, 12, 4.5);
    this.onMoveBanner?.(isAir ? '공중에 시간의 잔상!' : '시간의 잔상 기둥!', '#5bf0ff');
  }

  public clearChronoEcho(): void {
    if (this.echoGroup) {
      this.collision.removeDynamicBody('chrono_echo');
      this.scene.remove(this.echoGroup);
      this.echoGroup = null;
      this.echoColliderMesh = null;
      this.echoTimer = 0;
    }
  }

  public resetToSpawn(spawnPos: THREE.Vector3): void {
    this.pos.copy(spawnPos);
    this.lastSafePos.copy(spawnPos);
    this.vel.set(0, 0, 0);
    this.facingYaw = Math.PI;
    this.state = 'idle';
    this.grounded = false;
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.jumpCombo = 0;
    this.flipPitch = 0;
    this.spinYaw = 0;
    this.airEchoAvailable = true;
    this.root.position.copy(this.pos);
  }

  public heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  public takeDamage(amount: number, knockFrom?: THREE.Vector3): boolean {
    if (this.invulnTimer > 0 || this.state === 'star_dance') return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = 1.6;
    this.state = 'hurt';
    this.stateTimer = 0.42;
    this.grounded = false;
    this.vel.y = 11.5;

    if (knockFrom) {
      const dir = new THREE.Vector3(this.pos.x - knockFrom.x, 0, this.pos.z - knockFrom.z);
      if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
      dir.normalize();
      this.vel.x = dir.x * 9.5;
      this.vel.z = dir.z * 9.5;
    }

    this.sound.playHurt();
    this.particles.spawnSparkles(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xff5252, 10, 5);

    if (this.health <= 0) {
      // Respawn gently at courtyard with full health so player keeps exploring!
      this.health = this.maxHealth;
      this.pos.set(0, 4.0, 46.5);
      this.vel.set(0, 0, 0);
      this.state = 'idle';
      this.onMoveBanner?.('해시계 광장으로 돌아왔습니다', '#ff7b7b');
    }
    return true;
  }

  public registerFlowMove(moveName: string, accentColor: string): void {
    if (this.flowTimer > 0 && moveName !== this.lastFlowMove) {
      this.flowCombo++;
    } else if (this.flowTimer <= 0) {
      this.flowCombo = 1;
    }
    this.lastFlowMove = moveName;
    this.flowTimer = 3.2;

    const suffix = this.flowCombo >= 2 ? ` • ${this.flowCombo}x 시간 연계!` : '';
    this.onMoveBanner?.(`${moveName}${suffix}`, accentColor);
  }

  public enterStarDance(): void {
    this.state = 'star_dance';
    this.stateTimer = 2.2;
    this.vel.set(0, 0, 0);
    this.flipPitch = 0;
    this.spinYaw = 0;
    this.particles.spawnSparkles(this.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 0xffe047, 22, 6.5);
  }

  public exitStarDance(): void {
    if (this.state === 'star_dance') {
      this.state = 'idle';
    }
  }

  public bounceUp(vy: number, label?: string): void {
    this.grounded = false;
    this.vel.y = vy;
    this.state = 'jump2';
    this.flipPitch = 0;
    this.squash.set(0.75, 1.32, 0.75);
    this.sound.playBounce();
    this.particles.spawnShockRing(this.pos, 0xc084fc, 2.8, 0.3);
    if (label) {
      this.onMoveBanner?.(label, '#d8b4fe');
    }
  }

  public getHorizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  public update(
    dt: number,
    input: InputState,
    camForwardXZ: THREE.Vector3,
    camRightXZ: THREE.Vector3,
    phase: WorldPhase
  ): void {
    // Update 시간의 잔상 lifetime & pulsing animation
    if (this.echoGroup && this.echoColliderMesh) {
      this.echoTimer -= dt;
      const mat = this.echoColliderMesh.material as THREE.MeshStandardMaterial;
      if (this.echoTimer < 2.0) {
        mat.opacity = 0.35 + Math.abs(Math.sin(this.echoTimer * 12)) * 0.45;
      }
      if (this.echoTimer <= 0) {
        this.clearChronoEcho();
      }
    }

    if (input.echoPressed && this.state !== 'star_dance') {
      this.spawnChronoEcho();
    }

    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    }
    if (this.flowTimer > 0) {
      this.flowTimer = Math.max(0, this.flowTimer - dt);
      if (this.flowTimer === 0) {
        this.flowCombo = 0;
        this.lastFlowMove = '';
      } else if (this.flowCombo >= 2 && Math.random() < 0.35) {
        this.particles.spawnSparkles(
          this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)),
          phase === 'luna' ? 0x67e8f9 : 0xfacc15,
          1,
          1.6
        );
      }
    }

    if (this.state === 'star_dance') {
      this.stateTimer = Math.max(0, this.stateTimer - dt);
      this.spinYaw += dt * 5.2;
      this.animateCharacter(dt);
      this.updateDropShadow(phase);
      return;
    }

    // Carry player with any moving/rotating dynamic platform we stood on last step
    if (this.grounded && this.standingBody && this.standingBody.active) {
      const dYaw = this.collision.computePlatformDelta(this.standingBody, this.pos, this.platformDelta);
      this.pos.add(this.platformDelta);
      this.facingYaw += dYaw;
    } else {
      this.standingBody = null;
    }

    // Timers
    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
      if (this.comboResetTimer === 0) this.jumpCombo = 0;
    }
    if (this.coyoteTimer > 0) this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.wallCoyoteTimer > 0) this.wallCoyoteTimer = Math.max(0, this.wallCoyoteTimer - dt);
    if (this.groundPoundLandTimer > 0) this.groundPoundLandTimer = Math.max(0, this.groundPoundLandTimer - dt);

    if (input.jumpPressed) {
      this.jumpBufferTimer = 0.13;
    }

    // Compute world-space wish direction from camera-relative input
    const wishDir = new THREE.Vector3()
      .addScaledVector(camRightXZ, input.moveX)
      .addScaledVector(camForwardXZ, input.moveZ);
    const wishMag = Math.min(1, wishDir.length());
    if (wishMag > 0.001) {
      wishDir.normalize();
    }

    // ==================== STATE MACHINE ====================
    if (this.state === 'groundpound_start') {
      this.stateTimer -= dt;
      this.vel.set(0, 0, 0);
      this.flipPitch += dt * 26;
      if (this.stateTimer <= 0) {
        this.state = 'groundpound_fall';
        this.vel.set(0, -34.0, 0);
        this.flipPitch = 0;
      }
    } else if (this.state === 'groundpound_fall') {
      this.vel.x = 0;
      this.vel.z = 0;
      this.vel.y = -35.0;
    } else if (this.state === 'groundpound_land') {
      this.stateTimer -= dt;
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      // Allow crisp Ground-Pound Jump right out of impact!
      if (this.jumpBufferTimer > 0) {
        this.jumpBufferTimer = 0;
        this.grounded = false;
        this.vel.y = 21.2;
        this.state = 'jump3';
        this.flipPitch = 0;
        this.squash.set(0.72, 1.38, 0.72);
        this.sound.playJump('jump3');
        this.particles.spawnSparkles(this.pos, 0xffe066, 10, 5);
        this.onMoveBanner?.('엉덩이 찍기 도약!', '#ffd43b');
      } else if (this.stateTimer <= 0) {
        this.state = 'idle';
      }
    } else if (this.state === 'hurt') {
      this.stateTimer -= dt;
      this.vel.y += this.gravity * dt;
      if (this.stateTimer <= 0 && this.grounded) {
        this.state = 'idle';
      }
    } else if (this.grounded) {
      this.handleGroundedMovement(dt, input, wishDir, wishMag);
    } else {
      this.handleAirborneMovement(dt, input, wishDir, wishMag);
    }

    // ==================== INTEGRATE & COLLIDE ====================
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // 1. Resolve Horizontal Walls
    const wallHit = this.collision.resolveWalls(this.pos, this.radius, this.height, phase);
    if (wallHit) {
      // Remove inward velocity component into wall
      const intoWall = this.vel.x * wallHit.normal.x + this.vel.z * wallHit.normal.z;
      if (intoWall < 0) {
        this.vel.x -= wallHit.normal.x * intoWall;
        this.vel.z -= wallHit.normal.z * intoWall;
      }

      // Airborne Wall Slide / 벽차기 readiness!
      if (
        !this.grounded &&
        this.state !== 'groundpound_start' &&
        this.state !== 'groundpound_fall' &&
        this.vel.y < 5.5
      ) {
        this.wallNormal.copy(wallHit.normal);
        this.wallCoyoteTimer = 0.22;
        if (this.vel.y < -4.8) {
          this.vel.y = -4.8; // Controlled SM64 wall-slide!
          this.state = 'wallslide';
          this.facingYaw = Math.atan2(wallHit.normal.x, wallHit.normal.z);
          if (Math.random() < 0.45) {
            this.particles.spawnDust(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 1, 0.7);
          }
        }
      }
    } else if (this.state === 'wallslide') {
      this.state = 'jump1';
    }

    // Execute 벽차기 if Jump pressed while touching or just touching a wall!
    if (!this.grounded && this.wallCoyoteTimer > 0 && this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = 0;
      this.wallCoyoteTimer = 0;
      this.vel.y = 18.8;
      this.vel.x = this.wallNormal.x * 12.8;
      this.vel.z = this.wallNormal.z * 12.8;
      this.facingYaw = Math.atan2(this.wallNormal.x, this.wallNormal.z);
      this.state = 'wallkick';
      this.flipPitch = 0;
      this.squash.set(0.76, 1.32, 0.76);
      this.sound.playJump('wallkick');
      this.particles.spawnSparkles(
        this.pos.clone().add(new THREE.Vector3(0, 0.9, 0)),
        phase === 'luna' ? 0x67e8f9 : 0xffe066,
        9,
        4.5
      );
      this.registerFlowMove(
        wallHit?.surface === 'ice' ? '얼음 폭포 벽차기!' : '벽차기!',
        wallHit?.surface === 'ice' ? '#67e8f9' : '#fbbf24'
      );
    }

    // 2. Ceiling Check
    if (this.vel.y > 0) {
      const ceilY = this.collision.findCeiling(
        this.pos.x,
        this.pos.y,
        this.pos.y + this.height,
        this.pos.z,
        phase
      );
      if (ceilY !== null && this.pos.y + this.height > ceilY) {
        this.pos.y = ceilY - this.height;
        this.vel.y = 0;
      }
    }

    // 3. Floor Check & Step-Down Snapping
    const stepUp = this.grounded ? 0.78 : 0.48;
    const snapDown = this.grounded && this.vel.y <= 0.1 ? 0.68 : 0.08;
    const floor = this.collision.findFloor(this.pos.x, this.pos.y, this.pos.z, stepUp, phase);

    if (floor && this.vel.y <= 0.5 && this.pos.y <= floor.y + snapDown) {
      const wasAirborne = !this.grounded;
      const prevState = this.state;

      this.pos.y = floor.y;
      this.vel.y = 0;
      this.grounded = true;
      this.coyoteTimer = 0.12;
      this.airEchoAvailable = true;
      this.currentSurface = floor.surface;
      this.standingBody = floor.dynamicBody ?? null;

      // Save safe checkpoint on stable non-dynamic surfaces
      if (!floor.dynamicBody && floor.tag !== 'hazard') {
        this.lastSafePos.set(this.pos.x, floor.y + 0.5, this.pos.z);
      }

      if (wasAirborne) {
        this.flipPitch = 0;
        this.spinYaw = 0;

        if (prevState === 'groundpound_fall') {
          this.state = 'groundpound_land';
          this.stateTimer = 0.24;
          this.groundPoundLandTimer = 0.24;
          this.squash.set(1.42, 0.55, 1.42);
          this.sound.playGroundPoundImpact();
          this.particles.spawnShockRing(this.pos, 0xffd43b, 4.6, 0.36);
          this.particles.spawnDust(this.pos, 10, 2.5);
          this.onGroundPoundImpact?.(this.pos.clone());
        } else if (prevState === 'dive') {
          this.state = 'diveslide';
          this.squash.set(1.2, 0.72, 1.2);
          this.particles.spawnDust(this.pos, 6, 1.8);
        } else {
          // Arm Single -> Double -> Triple jump combo window!
          this.comboResetTimer = 0.24;
          this.squash.set(1.18, 0.82, 1.18);
          this.particles.spawnDust(this.pos, 4, 1.2);
          this.sound.playStep(this.currentSurface);
          this.state = this.getHorizontalSpeed() > 0.8 ? 'run' : 'idle';
        }
      }
    } else {
      this.grounded = false;
      this.standingBody = null;
    }

    // 4. Out-of-bounds Abyss Safety Net (teleports back to last safe ledge cleanly!)
    if (this.pos.y < -18) {
      this.takeDamage(2);
      this.pos.copy(this.lastSafePos);
      this.pos.y += 1.2;
      this.vel.set(0, 0, 0);
      this.grounded = false;
      this.state = 'idle';
      this.onMoveBanner?.('바람의 도움으로 안전하게 복귀!', '#93c5fd');
    }

    // Update visual rig & drop shadow
    this.root.position.copy(this.pos);
    this.animateCharacter(dt);
    this.updateDropShadow(phase);
  }

  private handleGroundedMovement(
    dt: number,
    input: InputState,
    wishDir: THREE.Vector3,
    wishMag: number
  ): void {
    const horizSpeed = this.getHorizontalSpeed();

    // Belly Dive Slide state
    if (this.state === 'diveslide') {
      const friction = this.currentSurface === 'ice' ? 2.0 : 9.5;
      const nextSpd = Math.max(0, horizSpeed - friction * dt);
      if (horizSpeed > 0.001) {
        this.vel.x = (this.vel.x / horizSpeed) * nextSpd;
        this.vel.z = (this.vel.z / horizSpeed) * nextSpd;
      }
      if (Math.random() < 0.5) this.particles.spawnDust(this.pos, 1, 0.9);

      // Dive Rollout!
      if (this.jumpBufferTimer > 0) {
        this.jumpBufferTimer = 0;
        this.grounded = false;
        this.vel.y = 13.5;
        const boost = Math.max(nextSpd, 13.2);
        this.vel.x = Math.sin(this.facingYaw) * boost;
        this.vel.z = Math.cos(this.facingYaw) * boost;
        this.state = 'rollout';
        this.flipPitch = 0;
        this.sound.playJump('rollout');
        this.onMoveBanner?.('다이빙 후 구르기!', '#a3e635');
        return;
      }
      if (nextSpd < 2.2) {
        this.state = 'idle';
      }
      return;
    }

    // Crouch handling -> 뒤돌기 or 멀리뛰기!
    if (input.crouchHeld) {
      // Decelerate while crouching
      const decel = 18 * dt;
      if (horizSpeed > 0.01) {
        const ns = Math.max(0, horizSpeed - decel);
        this.vel.x = (this.vel.x / horizSpeed) * ns;
        this.vel.z = (this.vel.z / horizSpeed) * ns;
      }
      this.state = 'crouch';

      if (this.jumpBufferTimer > 0) {
        this.jumpBufferTimer = 0;
        this.grounded = false;
        this.coyoteTimer = 0;

        if (horizSpeed > 4.2 || (wishMag > 0.5 && horizSpeed > 2.4)) {
          // CLASSIC SM64 멀리뛰기! ("YAHOO!")
          const dirX = wishMag > 0.3 ? wishDir.x : Math.sin(this.facingYaw);
          const dirZ = wishMag > 0.3 ? wishDir.z : Math.cos(this.facingYaw);
          this.facingYaw = Math.atan2(dirX, dirZ);
          const ljSpeed = Math.min(22.0, Math.max(18.8, horizSpeed * 1.48));
          this.vel.x = dirX * ljSpeed;
          this.vel.z = dirZ * ljSpeed;
          this.vel.y = 12.6;
          this.state = 'longjump';
          this.squash.set(0.8, 0.85, 1.35);
          this.sound.playJump('longjump');
          this.particles.spawnDust(this.pos, 7, 2.0);
          this.registerFlowMove('멀리뛰기!', '#38bdf8');
        } else {
          // CLASSIC SM64 BACKFLIP!
          this.vel.x = -Math.sin(this.facingYaw) * 4.2;
          this.vel.z = -Math.cos(this.facingYaw) * 4.2;
          this.vel.y = 22.2;
          this.state = 'backflip';
          this.flipPitch = 0;
          this.squash.set(0.72, 1.36, 0.72);
          this.sound.playJump('backflip');
          this.particles.spawnSparkles(this.pos, 0xc084fc, 8, 4);
          this.registerFlowMove('뒤돌기!', '#c084fc');
        }
      }
      return;
    }

    // Dive from ground run!
    if (input.divePressed && horizSpeed > 3.5) {
      this.grounded = false;
      this.vel.x = Math.sin(this.facingYaw) * 16.8;
      this.vel.z = Math.cos(this.facingYaw) * 16.8;
      this.vel.y = 8.6;
      this.state = 'dive';
      this.sound.playDive();
      this.particles.spawnDust(this.pos, 6, 1.6);
      this.onMoveBanner?.('다이빙!', '#fb923c');
      return;
    }

    // Analog Acceleration / Skid Detection
    if (wishMag > 0.05) {
      const curDirX = horizSpeed > 0.5 ? this.vel.x / horizSpeed : Math.sin(this.facingYaw);
      const curDirZ = horizSpeed > 0.5 ? this.vel.z / horizSpeed : Math.cos(this.facingYaw);
      const dot = curDirX * wishDir.x + curDirZ * wishDir.z;

      // Sharp reverse while running fast -> SM64 SKID (sets up 옆돌기!)
      if (horizSpeed > 6.2 && dot < -0.45 && this.state !== 'skid') {
        this.state = 'skid';
        this.stateTimer = 0.28;
        this.particles.spawnDust(this.pos, 5, 1.5);
      }

      if (this.state === 'skid') {
        this.stateTimer -= dt;
        this.vel.x *= Math.max(0, 1 - 12 * dt);
        this.vel.z *= Math.max(0, 1 - 12 * dt);
        if (Math.random() < 0.6) this.particles.spawnDust(this.pos, 1, 1.1);

        // SIDE SOMERSAULT (Jump during Skid!)
        if (this.jumpBufferTimer > 0) {
          this.jumpBufferTimer = 0;
          this.grounded = false;
          this.facingYaw = Math.atan2(wishDir.x, wishDir.z);
          this.vel.x = wishDir.x * 6.8;
          this.vel.z = wishDir.z * 6.8;
          this.vel.y = 21.8;
          this.state = 'sideflip';
          this.flipPitch = 0;
          this.spinYaw = 0;
          this.squash.set(0.72, 1.38, 0.72);
          this.sound.playJump('sideflip');
          this.particles.spawnSparkles(this.pos, 0x34d399, 10, 4.5);
          this.registerFlowMove('옆돌기!', '#34d399');
          return;
        }

        if (this.stateTimer <= 0 || horizSpeed < 1.8) {
          this.facingYaw = Math.atan2(wishDir.x, wishDir.z);
          this.state = 'run';
        }
      } else {
        // Smooth turn & accelerate
        const desiredYaw = Math.atan2(wishDir.x, wishDir.z);
        let diff = desiredYaw - this.facingYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.facingYaw += diff * Math.min(1, 14 * dt);

        const accel = this.currentSurface === 'ice' ? 22 : 44;
        const targetVx = wishDir.x * this.maxRunSpeed * wishMag;
        const targetVz = wishDir.z * this.maxRunSpeed * wishMag;
        this.vel.x += THREE.MathUtils.clamp(targetVx - this.vel.x, -accel * dt, accel * dt);
        this.vel.z += THREE.MathUtils.clamp(targetVz - this.vel.z, -accel * dt, accel * dt);
        this.state = 'run';

        this.stepSoundTimer -= dt * (0.6 + (horizSpeed / this.maxRunSpeed) * 0.8);
        if (this.stepSoundTimer <= 0) {
          this.stepSoundTimer = 0.25;
          this.sound.playStep(this.currentSurface);
          this.particles.spawnDust(this.pos, 1, 0.6);
        }
      }
    } else {
      // Natural ground friction to idle
      const friction = this.currentSurface === 'ice' ? 8 : 38;
      if (horizSpeed > 0.001) {
        const ns = Math.max(0, horizSpeed - friction * dt);
        this.vel.x = (this.vel.x / horizSpeed) * ns;
        this.vel.z = (this.vel.z / horizSpeed) * ns;
      }
      this.state = horizSpeed > 0.6 ? 'run' : 'idle';
    }

    // Standard Jump Chain: Single -> Double -> 3단 점프!
    if (this.jumpBufferTimer > 0) {
      this.executeStandardJump();
    }
  }

  private executeStandardJump(): void {
    this.jumpBufferTimer = 0;
    this.grounded = false;
    this.coyoteTimer = 0;
    const horizSpeed = this.getHorizontalSpeed();

    if (this.comboResetTimer > 0 && this.jumpCombo === 1) {
      this.jumpCombo = 2;
      this.vel.y = 18.2;
      this.state = 'jump2';
      this.squash.set(0.76, 1.30, 0.76);
      this.sound.playJump('jump2');
      this.onMoveBanner?.('2단 점프!', '#fde047');
    } else if (this.comboResetTimer > 0 && this.jumpCombo >= 2 && horizSpeed > 4.2) {
      // ICONIC SM64 TRIPLE JUMP!
      this.jumpCombo = 0;
      this.vel.y = 22.8;
      // Forward boost
      this.vel.x = Math.sin(this.facingYaw) * Math.max(horizSpeed, 11.5);
      this.vel.z = Math.cos(this.facingYaw) * Math.max(horizSpeed, 11.5);
      this.state = 'jump3';
      this.flipPitch = 0;
      this.squash.set(0.68, 1.44, 0.68);
      this.sound.playJump('jump3');
      this.particles.spawnSparkles(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xffdf40, 16, 5.5);
      this.registerFlowMove('★ 3단 점프! ★', '#ffd43b');
    } else {
      this.jumpCombo = 1;
      this.vel.y = 15.2;
      this.state = 'jump1';
      this.squash.set(0.80, 1.24, 0.80);
      this.sound.playJump('jump1');
    }
  }

  private handleAirborneMovement(
    dt: number,
    input: InputState,
    wishDir: THREE.Vector3,
    wishMag: number
  ): void {
    // Coyote time jump!
    if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0) {
      this.executeStandardJump();
      return;
    }

    // Mid-air 엉덩이 찍기!
    if (
      input.crouchPressed &&
      this.state !== 'dive' &&
      this.state !== 'longjump'
    ) {
      this.state = 'groundpound_start';
      this.stateTimer = 0.20;
      this.flipPitch = 0;
      this.vel.set(0, 0, 0);
      this.sound.playGroundPoundStart();
      this.onMoveBanner?.('엉덩이 찍기!', '#f97316');
      return;
    }

    // Mid-air Dive!
    if (
      input.divePressed &&
      this.state !== 'dive' &&
      this.state !== 'longjump'
    ) {
      if (wishMag > 0.25) {
        this.facingYaw = Math.atan2(wishDir.x, wishDir.z);
      }
      this.vel.x = Math.sin(this.facingYaw) * 16.2;
      this.vel.z = Math.cos(this.facingYaw) * 16.2;
      this.vel.y = Math.max(this.vel.y, 6.2);
      this.state = 'dive';
      this.sound.playDive();
      this.onMoveBanner?.('공중 다이빙!', '#fb923c');
      return;
    }

    // Responsive air control (preserves 멀리뛰기 momentum while allowing subtle steering!)
    const airAccel = this.state === 'longjump' ? 14 : this.state === 'dive' ? 6 : 24;
    if (wishMag > 0.05) {
      const cap = this.state === 'longjump' ? 21.5 : this.maxRunSpeed;
      const targetVx = wishDir.x * cap * wishMag;
      const targetVz = wishDir.z * cap * wishMag;
      this.vel.x += THREE.MathUtils.clamp(targetVx - this.vel.x, -airAccel * dt, airAccel * dt);
      this.vel.z += THREE.MathUtils.clamp(targetVz - this.vel.z, -airAccel * dt, airAccel * dt);

      if (this.state !== 'backflip' && this.state !== 'wallslide' && this.state !== 'dive') {
        const desiredYaw = Math.atan2(wishDir.x, wishDir.z);
        let diff = desiredYaw - this.facingYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.facingYaw += diff * Math.min(1, 7 * dt);
      }
    }

    // Variable jump height (releasing Space early slightly trims upward jump1/jump2 apex)
    let grav = this.gravity;
    if (
      !input.jumpHeld &&
      this.vel.y > 4 &&
      (this.state === 'jump1' || this.state === 'jump2')
    ) {
      grav *= 1.48;
    }
    this.vel.y = Math.max(-36, this.vel.y + grav * dt);

    // Sparkle trail during 3단 점프 / 옆돌기 / 뒤돌기!
    if (
      (this.state === 'jump3' || this.state === 'sideflip' || this.state === 'backflip') &&
      Math.random() < 0.4
    ) {
      this.particles.spawnSparkles(this.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffe066, 1, 1.5);
    }
  }

  private animateCharacter(dt: number): void {
    // Recover squash & stretch smoothly
    this.squash.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-14 * dt));
    this.visualRig.scale.copy(this.squash);

    // Blink invulnerability
    if (this.invulnTimer > 0) {
      this.visualRig.visible = Math.floor(this.invulnTimer * 18) % 2 === 0;
    } else {
      this.visualRig.visible = true;
    }

    // 회전 clockwork gear emblem on hero's back!
    this.capeClockGear.rotation.z += dt * (1.2 + this.getHorizontalSpeed() * 0.45);

    // Reset default limb transforms
    this.visualRig.position.y = 0;
    this.visualRig.rotation.set(0, this.facingYaw, 0);
    this.torso.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);

    const speed = this.getHorizontalSpeed();

    switch (this.state) {
      case 'idle': {
        const breath = Math.sin(performance.now() * 0.004);
        this.torso.position.y = 0.72 + breath * 0.025;
        this.leftArm.rotation.set(breath * 0.08, 0, 0.14);
        this.rightArm.rotation.set(-breath * 0.08, 0, -0.14);
        this.leftLeg.rotation.set(0, 0, 0);
        this.rightLeg.rotation.set(0, 0, 0);
        break;
      }
      case 'run': {
        this.runCycle += dt * (6 + speed * 1.05);
        const s = Math.sin(this.runCycle);
        this.torso.position.y = 0.72 + Math.abs(Math.cos(this.runCycle)) * 0.08;
        this.torso.rotation.x = 0.20 * (speed / this.maxRunSpeed); // Heroic forward lean!
        this.leftArm.rotation.set(s * 1.15, 0, 0.22);
        this.rightArm.rotation.set(-s * 1.15, 0, -0.22);
        this.leftLeg.rotation.set(-s * 1.1, 0, 0);
        this.rightLeg.rotation.set(s * 1.1, 0, 0);
        break;
      }
      case 'skid': {
        this.torso.rotation.x = -0.38;
        this.leftArm.rotation.set(-0.8, 0, 0.6);
        this.rightArm.rotation.set(-0.8, 0, -0.6);
        this.leftLeg.rotation.set(0.5, 0, 0);
        this.rightLeg.rotation.set(-0.3, 0, 0);
        break;
      }
      case 'crouch': {
        this.visualRig.scale.set(1.16, 0.66, 1.16);
        this.torso.rotation.x = 0.42;
        this.leftArm.rotation.set(0.5, 0, 0.35);
        this.rightArm.rotation.set(0.5, 0, -0.35);
        break;
      }
      case 'jump1':
      case 'wallkick': {
        // Classic Mario fist-up jump pose!
        this.leftArm.rotation.set(0.5, 0, 0.35);
        this.rightArm.rotation.set(-2.6, 0, -0.15);
        this.leftLeg.rotation.set(0.5, 0, 0);
        this.rightLeg.rotation.set(-0.65, 0, 0);
        break;
      }
      case 'jump2':
      case 'rollout': {
        this.spinYaw += dt * 11;
        this.visualRig.rotation.y = this.facingYaw + this.spinYaw;
        this.leftArm.rotation.set(0, 0, 1.2);
        this.rightArm.rotation.set(0, 0, -1.2);
        break;
      }
      case 'jump3': {
        // Double forward somersault!
        this.flipPitch += dt * 13.5;
        this.visualRig.position.y = 0.85;
        this.visualRig.rotation.x = this.flipPitch;
        this.torso.position.y = -0.15;
        this.leftArm.rotation.set(-2.2, 0, 0.3);
        this.rightArm.rotation.set(-2.2, 0, -0.3);
        break;
      }
      case 'backflip': {
        this.flipPitch -= dt * 12.5;
        this.visualRig.position.y = 0.85;
        this.visualRig.rotation.x = this.flipPitch;
        this.torso.position.y = -0.15;
        break;
      }
      case 'sideflip': {
        this.flipPitch += dt * 11.5;
        this.spinYaw += dt * 5.5;
        this.visualRig.position.y = 0.85;
        this.visualRig.rotation.set(this.flipPitch, this.facingYaw + this.spinYaw, 0);
        this.torso.position.y = -0.15;
        break;
      }
      case 'longjump': {
        this.torso.rotation.x = -0.32;
        this.leftLeg.rotation.set(-0.95, 0, -0.15);
        this.rightLeg.rotation.set(-0.85, 0, 0.15);
        this.leftArm.rotation.set(0.95, 0, 0.5);
        this.rightArm.rotation.set(0.95, 0, -0.5);
        break;
      }
      case 'dive':
      case 'diveslide': {
        this.visualRig.position.y = 0.32;
        this.torso.rotation.x = Math.PI * 0.46;
        this.headGroup.rotation.x = -0.65;
        this.leftArm.rotation.set(-2.6, 0, 0.25);
        this.rightArm.rotation.set(-2.6, 0, -0.25);
        this.leftLeg.rotation.set(0.35, 0, 0);
        this.rightLeg.rotation.set(0.35, 0, 0);
        break;
      }
      case 'groundpound_start': {
        this.visualRig.position.y = 0.85;
        this.visualRig.rotation.x = this.flipPitch;
        this.torso.position.y = -0.15;
        break;
      }
      case 'groundpound_fall': {
        this.visualRig.scale.set(0.82, 1.28, 0.82);
        this.leftArm.rotation.set(-2.4, 0, 0.4);
        this.rightArm.rotation.set(-2.4, 0, -0.4);
        this.leftLeg.rotation.set(-0.8, 0, 0);
        this.rightLeg.rotation.set(-0.8, 0, 0);
        break;
      }
      case 'wallslide': {
        this.torso.rotation.x = -0.2;
        this.leftArm.rotation.set(-2.2, 0, 0.4);
        this.rightArm.rotation.set(0.4, 0, -0.5);
        break;
      }
      case 'star_dance': {
        this.visualRig.rotation.y = this.facingYaw + this.spinYaw;
        this.torso.position.y = 0.78 + Math.abs(Math.sin(this.spinYaw * 2)) * 0.16;
        this.rightArm.rotation.set(-2.7, 0, -0.35);
        this.leftArm.rotation.set(-0.6, 0, 0.85);
        this.leftLeg.rotation.set(0.25, 0, -0.15);
        this.rightLeg.rotation.set(-0.35, 0, 0.15);
        break;
      }
    }
  }

  private updateDropShadow(phase: WorldPhase): void {
    const floor = this.collision.findFloor(this.pos.x, this.pos.y, this.pos.z, 0.5, phase, 0.05);
    if (floor) {
      const dist = Math.max(0, this.pos.y - floor.y);
      this.dropShadow.visible = dist < 26;
      this.dropShadow.position.set(this.pos.x, floor.y + 0.04, this.pos.z);
      const scale = THREE.MathUtils.clamp(1.05 - dist * 0.032, 0.35, 1.05);
      this.dropShadow.scale.setScalar(scale);
      this.shadowMat.opacity = THREE.MathUtils.clamp(0.75 - dist * 0.025, 0.18, 0.75);
    } else {
      this.dropShadow.visible = false;
    }
  }
}
