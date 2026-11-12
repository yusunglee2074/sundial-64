import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import {
  PhaseVisualManager,
  createBrassTexture,
  createCheckerGrassTexture,
  createPhaseBlockTexture,
  createStoneBrickTexture,
  createSundialPlazaTexture,
  createWaterfallTexture,
} from '../graphics/PhaseShader';
import { StageEntities } from '../entities/StageEntities';
import { PhaseRule, SurfaceType, WorldPhase } from '../types';

interface PhasePlatformVisual {
  rule: 'sol' | 'luna';
  solidMesh: THREE.Mesh;
  solidMat: THREE.MeshStandardMaterial;
  ghostWire: THREE.Mesh;
}

interface RotatingGear {
  mesh: THREE.Mesh;
  speed: number;
  axis: 'y' | 'z';
}

interface MovingElevator {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  deltaPos: THREE.Vector3;
  speed: number;
  phaseOffset: number;
  clock: number;
}

export class StageBuilder {
  private phasePlatforms: PhasePlatformVisual[] = [];
  private gears: RotatingGear[] = [];
  private elevators: MovingElevator[] = [];

  private waterfallTex!: THREE.CanvasTexture;
  private waterfallMeshes: THREE.Mesh[] = [];
  private waterfallSolMat!: THREE.MeshStandardMaterial;
  private waterfallIceMat!: THREE.MeshStandardMaterial;

  private oceanMesh!: THREE.Mesh;
  private oceanMat!: THREE.MeshStandardMaterial;
  private sundialShadowHand!: THREE.Mesh;
  private cloudGroup = new THREE.Group();
  private skySunGroup = new THREE.Group();
  private skyMoonGroup = new THREE.Group();
  private starfieldPoints!: THREE.Points;
  private starfieldMat!: THREE.PointsMaterial;

  // Shared materials
  private grassMat!: THREE.MeshStandardMaterial;
  private cliffMat!: THREE.MeshStandardMaterial;
  private stoneMat!: THREE.MeshStandardMaterial;
  private plazaMat!: THREE.MeshStandardMaterial;
  private brassMat!: THREE.MeshStandardMaterial;
  private sandMat!: THREE.MeshStandardMaterial;
  private solBlockTex!: THREE.CanvasTexture;
  private lunaBlockTex!: THREE.CanvasTexture;

  constructor(
    private scene: THREE.Scene,
    private collision: CollisionWorld,
    private phaseVisuals: PhaseVisualManager,
    private entities: StageEntities
  ) {
    this.initMaterials();
    this.buildSkyAndOcean();
    this.buildIslandBaseAndPlaza();
    this.buildTwinCascadesGorge();
    this.buildClockworkMountainAndSummit();
    this.buildSkywayOfShiftingPhases();
    this.populateDecorTreesAndClouds();
  }

  private initMaterials(): void {
    const grassTex = createCheckerGrassTexture();
    grassTex.repeat.set(16, 16);
    this.grassMat = this.phaseVisuals.makePhaseMaterial({
      map: grassTex,
      roughness: 0.78,
      lunaTint: 0x3b6ca8,
      lunaEmissive: 0x07182e,
    });

    const cliffTex = createStoneBrickTexture('#9e8872', '#75624f');
    cliffTex.repeat.set(6, 6);
    this.cliffMat = this.phaseVisuals.makePhaseMaterial({
      map: cliffTex,
      roughness: 0.85,
      lunaTint: 0x4b5c8a,
      lunaEmissive: 0x080e24,
    });

    const stoneTex = createStoneBrickTexture('#dfd4c3', '#b3a38e');
    stoneTex.repeat.set(3, 3);
    this.stoneMat = this.phaseVisuals.makePhaseMaterial({
      map: stoneTex,
      roughness: 0.68,
      lunaTint: 0x677db8,
      lunaEmissive: 0x0b132b,
    });

    const plazaTex = createSundialPlazaTexture();
    this.plazaMat = this.phaseVisuals.makePhaseMaterial({
      map: plazaTex,
      roughness: 0.62,
      lunaTint: 0x6b82c4,
      lunaEmissive: 0x0d1836,
    });

    const brassTex = createBrassTexture();
    this.brassMat = this.phaseVisuals.makePhaseMaterial({
      map: brassTex,
      metalness: 0.62,
      roughness: 0.30,
      lunaTint: 0x6892d6,
      lunaEmissive: 0x0c1a38,
    });

    this.sandMat = this.phaseVisuals.makePhaseMaterial({
      color: 0xf4d58d,
      roughness: 0.85,
      lunaTint: 0x4f649e,
      lunaEmissive: 0x070f24,
    });

    this.solBlockTex = createPhaseBlockTexture('sol');
    this.lunaBlockTex = createPhaseBlockTexture('luna');

    this.waterfallTex = createWaterfallTexture();
    this.waterfallTex.repeat.set(2, 5);

    this.waterfallSolMat = new THREE.MeshStandardMaterial({
      map: this.waterfallTex,
      color: 0x5eead4,
      emissive: 0x0d9488,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.72,
      roughness: 0.25,
    });

    this.waterfallIceMat = new THREE.MeshStandardMaterial({
      map: this.waterfallTex,
      color: 0xa5f3fc,
      emissive: 0x0284c7,
      emissiveIntensity: 0.55,
      metalness: 0.25,
      roughness: 0.12,
    });
  }

  // ==================== GEOMETRY REGISTRATION HELPERS ====================

  private addSolidBox(
    w: number,
    h: number,
    d: number,
    x: number,
    yTop: number,
    z: number,
    mat: THREE.Material,
    surface: SurfaceType = 'stone',
    rotX = 0,
    rotY = 0,
    rotZ = 0
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, yTop - h * 0.5, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.collision.addStaticMesh(mesh, 'both', surface);
    return mesh;
  }

  private addSolidCylinder(
    rTop: number,
    rBot: number,
    h: number,
    segs: number,
    x: number,
    yTop: number,
    z: number,
    mat: THREE.Material,
    surface: SurfaceType = 'stone'
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), mat);
    mesh.position.set(x, yTop - h * 0.5, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.collision.addStaticMesh(mesh, 'both', surface);
    return mesh;
  }

  /**
   * Connects point A (yTopA) to point B (yTopB) with a smooth walkable sloped stone/grass ramp!
   */
  private addRampBetween(
    ax: number,
    ayTop: number,
    az: number,
    bx: number,
    byTop: number,
    bz: number,
    width: number,
    thickness: number,
    mat: THREE.Material,
    surface: SurfaceType = 'stone'
  ): THREE.Mesh {
    const dx = bx - ax;
    const dy = byTop - ayTop;
    const dz = bz - az;
    const horizLen = Math.hypot(dx, dz);
    const slopeLen = Math.hypot(horizLen, dy) + 0.6; // Slight overlap so seams are buttery smooth!
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, horizLen);

    const group = new THREE.Object3D();
    const midX = (ax + bx) * 0.5;
    const midY = (ayTop + byTop) * 0.5;
    const midZ = (az + bz) * 0.5;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, slopeLen), mat);
    group.position.set(midX, midY, midZ);
    group.rotation.set(0, yaw, 0);
    group.rotateX(pitch);
    // Shift down along local normal by thickness/2 so top face aligns with ayTop -> byTop!
    group.translateY(-thickness * 0.5);
    group.updateMatrix();

    mesh.position.copy(group.position);
    mesh.quaternion.copy(group.quaternion);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.collision.addStaticMesh(mesh, 'both', surface);
    return mesh;
  }

  /**
   * Adds a Sol-only or Luna-only Phase Platform that shows a clear holographic constellation
   * outline when inactive, and turns solid & collidable when its phase is active!
   */
  private addPhaseBox(
    rule: 'sol' | 'luna',
    w: number,
    h: number,
    d: number,
    x: number,
    yTop: number,
    z: number,
    rotY = 0
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(w, h, d);
    const solidMat = new THREE.MeshStandardMaterial({
      map: rule === 'sol' ? this.solBlockTex : this.lunaBlockTex,
      color: rule === 'sol' ? 0xffbe3b : 0x56b4ff,
      emissive: rule === 'sol' ? 0x6e3b00 : 0x12458a,
      roughness: 0.28,
      metalness: 0.25,
      transparent: true,
      opacity: 1.0,
    });

    const solidMesh = new THREE.Mesh(geo, solidMat);
    solidMesh.position.set(x, yTop - h * 0.5, z);
    solidMesh.rotation.y = rotY;
    solidMesh.castShadow = true;
    solidMesh.receiveShadow = true;
    this.scene.add(solidMesh);

    const wireMat = new THREE.MeshBasicMaterial({
      color: rule === 'sol' ? 0xffd166 : 0x72efdd,
      wireframe: true,
      transparent: true,
      opacity: 0.48,
    });
    const ghostWire = new THREE.Mesh(geo, wireMat);
    ghostWire.position.copy(solidMesh.position);
    ghostWire.rotation.copy(solidMesh.rotation);
    ghostWire.scale.setScalar(1.015);
    this.scene.add(ghostWire);

    this.collision.addStaticMesh(solidMesh, rule, rule === 'sol' ? 'brass' : 'astral');
    this.phasePlatforms.push({ rule, solidMesh, solidMat, ghostWire });
    return solidMesh;
  }

  // ==================== SKY, STARFIELD & OCEAN ====================

  private buildSkyAndOcean(): void {
    // Sparkling surrounding sea + walkable shallow sandy shore so falling in water lets you hop right back!
    const oceanGeo = new THREE.CircleGeometry(280, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMat = new THREE.MeshStandardMaterial({
      color: 0x1ea7e1,
      emissive: 0x053a5e,
      roughness: 0.22,
      metalness: 0.15,
    });
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.oceanMesh.position.y = -1.6;
    this.scene.add(this.oceanMesh);

    // Walkable shallow sea-floor at y = -1.7 around island so player never drowns in shallow bay!
    const seaFloor = new THREE.Mesh(new THREE.CylinderGeometry(92, 92, 2, 32), this.sandMat);
    seaFloor.position.set(0, -2.7, 0);
    seaFloor.visible = false;
    this.scene.add(seaFloor);
    this.collision.addStaticMesh(seaFloor, 'both', 'sand');

    // Astral Luna Starfield dome
    const starCount = 650;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(0.12 + Math.random() * 0.88);
      const r = 195 + Math.random() * 35;
      positions[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i * 3 + 1] = Math.cos(phi) * r;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starfieldMat = new THREE.PointsMaterial({
      color: 0xe0f2fe,
      size: 1.35,
      transparent: true,
      opacity: 0.0,
    });
    this.starfieldPoints = new THREE.Points(starGeo, this.starfieldMat);
    this.scene.add(this.starfieldPoints);

    // 3D Celestial Clockwork Sun (Sol) & Astral Moon Ring (Luna) above the northern horizon!
    this.skySunGroup.position.set(-45, 78, -125);
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(9.5, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xffe066 })
    );
    this.skySunGroup.add(sunDisc);
    const sunHalo = new THREE.Mesh(
      new THREE.RingGeometry(11.5, 14.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    );
    sunHalo.lookAt(0, 10, 40);
    this.skySunGroup.add(sunHalo);
    this.scene.add(this.skySunGroup);

    this.skyMoonGroup.position.set(48, 82, -125);
    const moonDisc = new THREE.Mesh(
      new THREE.SphereGeometry(8.2, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xa5f3fc })
    );
    this.skyMoonGroup.add(moonDisc);
    const moonRing = new THREE.Mesh(
      new THREE.TorusGeometry(13.5, 0.55, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    moonRing.rotation.x = 1.05;
    moonRing.rotation.y = 0.35;
    this.skyMoonGroup.add(moonRing);
    this.skyMoonGroup.visible = false;
    this.scene.add(this.skyMoonGroup);
  }

  // ==================== ZONE 0: ISLAND BASE & SUNDIAL PLAZA ====================

  private buildIslandBaseAndPlaza(): void {
    // Sandy beach ring (yTop = -0.3) + sloped beach ramp back onto grass
    this.addSolidCylinder(66, 72, 3.0, 32, 0, -0.3, 4, this.sandMat, 'sand');
    // Lush N64 Emerald Island Lawn (yTop = 0.8)
    this.addSolidCylinder(58, 63, 3.2, 32, 0, 0.8, 4, this.grassMat, 'grass');
    // Gentle beach-to-grass ramp at south shore
    this.addRampBetween(0, -0.3, 64, 0, 0.8, 54, 12, 1.5, this.sandMat, 'sand');

    // Grand Circular Sundial Courtyard Plaza (center (0, 2.0, 34), radius 21) + Arrival Promenade!
    this.addSolidCylinder(21, 22.5, 2.4, 32, 0, 2.0, 34, this.plazaMat, 'stone');
    this.addSolidBox(11, 2.4, 16, 0, 2.0, 45.5, this.stoneMat, 'stone');
    this.addRampBetween(0, 0.8, 56, 0, 2.0, 52, 9, 1.4, this.stoneMat, 'stone');
    // Gentle steps from grass (0.8) up to Plaza (2.0) on West & East
    this.addRampBetween(-24, 0.8, 30, -19, 2.0, 31, 8, 1.5, this.stoneMat, 'stone');
    this.addRampBetween(24, 0.8, 30, 19, 2.0, 31, 8, 1.5, this.stoneMat, 'stone');

    // Central Sundial Dais & Golden Gnomon Fin!
    this.addSolidCylinder(4.6, 5.2, 0.55, 20, 0, 2.55, 31, this.stoneMat, 'stone');
    // Stepped Gnomon Pedestal + Tall Sundial Pointer (뒤돌기/옆돌기/Triple-Jump target!)
    this.addSolidBox(2.2, 3.6, 2.6, 0, 6.15, 29.2, this.brassMat, 'brass');
    this.addRampBetween(0, 2.55, 32.8, 0, 4.4, 30.5, 1.8, 0.8, this.brassMat, 'brass');

    // Rotating shadow/light indicator arm on plaza floor
    const handGeo = new THREE.BoxGeometry(0.45, 0.08, 14);
    handGeo.translate(0, 0, -7);
    this.sundialShadowHand = new THREE.Mesh(
      handGeo,
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.55 })
    );
    this.sundialShadowHand.position.set(0, 2.05, 31);
    this.scene.add(this.sundialShadowHand);

    // Red Coin #1 atop Sundial Gnomon!
    this.entities.addRedCoin(0, 7.25, 29.2);

    // Red Coin Star Marker Pedestal & ★ Power Star #3 (spawns at 8/8 Red Coins!)
    this.addSolidCylinder(1.6, 1.9, 0.35, 12, 0, 2.35, 35.5, this.brassMat, 'brass');
    this.entities.registerPowerStar(3, 0, 4.2, 35.5, false);

    // Welcoming Yellow Coin Arc across Plaza
    this.entities.addCoinRing(0, 2.8, 31, 8.2, 8);

    // Ornate Courtyard Pillars around north rim
    for (const px of [-14, 14]) {
      this.addSolidCylinder(0.85, 1.0, 5.5, 12, px, 7.5, 20, this.stoneMat, 'stone');
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x78350f, roughness: 0.2 })
      );
      orb.position.set(px, 8.2, 20);
      this.scene.add(orb);
    }

    // Helpful N64 Wooden Signposts
    this.entities.addSignpost(
      5.2,
      2.0,
      35.5,
      -0.4,
      '해시계 성역 — 낮과 밤의 비밀',
      '[F] 또는 마우스 오른쪽으로 언제든 낮과 밤을 바꿀 수 있어요. 공중에서도 가능합니다! [R]로 시간의 잔상 발판을 만드세요.'
    );
    this.entities.addSignpost(
      -15.5,
      2.0,
      25.5,
      0.6,
      '서쪽: 쌍둥이 폭포 협곡',
      '[F]로 밤이 되면 폭포가 얼음벽으로 변해요. 벽에 닿을 때 [Space]로 벽차기를 이어가세요! 비밀: 낮에는 아래쪽 폭포 뒤로 들어갈 수 있어요.'
    );
    this.entities.addSignpost(
      13.5,
      2.0,
      24.5,
      -0.6,
      '동쪽: 태엽길과 하늘길',
      '돌길을 따라 시계왕이 있는 정상으로 가거나, 종탑에서 동쪽으로 가서 멀리뛰기에 도전하세요! 달리면서 [Shift + Space]를 누르면 됩니다.'
    );
  }

  // ==================== ZONE 1: TWIN CASCADES GORGE & FROZEN FALLS (★ STAR #2) ====================

  private buildTwinCascadesGorge(): void {
    // Grassy stepping path from Plaza West (-18, 0.8, 22) -> Cascade Basin Forecourt (-38, 3.2, 4)
    this.addSolidCylinder(7.5, 8.5, 2.2, 16, -26, 2.0, 17, this.grassMat, 'grass');
    this.entities.addGoombot(-26, 2.0, 17, 3.0);
    this.addRampBetween(-19, 2.0, 25, -24, 2.0, 19, 5.5, 1.2, this.stoneMat, 'stone');
    this.addRampBetween(-29, 2.0, 14, -37, 3.2, 6, 5.8, 1.4, this.stoneMat, 'stone');

    // Waterfall Forecourt & Turquoise Pool Rim (-42, 3.2, 2)
    this.addSolidBox(18, 4.2, 14, -42, 3.2, 2, this.stoneMat, 'stone');

    // --- SECRET WATERFALL GROTTO (Walk behind liquid Lower Waterfall in SOL!) ---
    // Cavern Floor (-42, 3.2, -9.5), Side Walls & Roof
    this.addSolidBox(12, 4.2, 10, -42, 3.2, -9.5, this.cliffMat, 'stone');
    this.addSolidBox(2.5, 9.5, 10, -47.5, 12.7, -9.5, this.cliffMat, 'stone');
    this.addSolidBox(2.5, 9.5, 10, -36.5, 12.7, -9.5, this.cliffMat, 'stone');
    this.addSolidBox(14, 2.5, 12, -42, 14.5, -10.0, this.cliffMat, 'stone'); // Grotto ceiling + upper terrace!
    this.addSolidBox(14, 12.0, 2.5, -42, 14.5, -15.0, this.cliffMat, 'stone'); // Back wall of grotto

    // Red Coin #2 + Treasure Ring hidden inside the Waterfall Grotto!
    this.entities.addRedCoin(-42, 4.5, -9.5);
    this.entities.addCoinRing(-42, 4.1, -9.5, 2.8, 6);

    // Lower Waterfall Curtain at z = -4.2 (Liquid in Sol so you walk right in; Solid Ice in Luna!)
    this.createWaterfallWall(7.8, 9.2, 1.1, -42, 12.2, -4.2);

    // --- RAMP UP TO CHUTE ENTRY PLATFORM (y = 4.5 at (-44, 4.5, -16)) ---
    // Wrap-around cliff steps on the right side of the Forecourt (-33, 3.2 -> 5.2, -6..-15)
    this.addRampBetween(-34, 3.2, -1, -33, 5.2, -12, 4.8, 1.4, this.stoneMat, 'stone');
    this.addSolidBox(18, 6.2, 7.5, -41, 5.2, -15.5, this.stoneMat, 'stone');

    // --- LOWER TWIN WATERFALL WALL-KICK CHUTE (y = 5.2 -> 18.2, clear width = 5.4u!) ---
    // Back cliff wall keeping player aligned inside the chute
    this.addSolidBox(13, 32, 3.0, -44, 34.0, -24.2, this.cliffMat, 'stone');
    // Solid cliff rock columns framing the waterfalls
    this.addSolidBox(3.0, 28, 7.0, -49.6, 31.0, -20.0, this.cliffMat, 'stone');
    this.addSolidBox(3.0, 28, 7.0, -38.4, 31.0, -20.0, this.cliffMat, 'stone');

    // TWIN WATERFALL COLUMNS:
    // Left Waterfall: center x = -47.4, width = 1.4 -> inner ice wall at x = -46.7
    // Right Waterfall: center x = -40.6, width = 1.4 -> inner ice wall at x = -41.3
    // Clear interior width = 5.4 units! Sweet spot for chained SM64 벽차기s!
    this.createWaterfallWall(1.4, 14.5, 5.8, -47.4, 19.2, -20.0);
    this.createWaterfallWall(1.4, 14.5, 5.8, -40.6, 19.2, -20.0);

    // Guiding vertical coin line inside the chute!
    this.entities.addCoinLine(new THREE.Vector3(-44, 7.5, -20), new THREE.Vector3(-44, 16.5, -20), 4);

    // --- MID-CASCADE REST BALCONY (yTop = 18.2, wraps forward/left around chute) ---
    this.addSolidBox(9.5, 2.0, 8.5, -51.5, 18.2, -20.0, this.stoneMat, 'stone');
    // Bridge ledge at y = 18.2 right at top of lower chute (-44, 18.2, -26.5) leading into Upper Chute!
    this.addSolidBox(14.0, 19.0, 8.0, -44.0, 18.2, -28.5, this.cliffMat, 'stone');
    // Red Coin #3 on the Mid-Cascade Balcony!
    this.entities.addRedCoin(-52.5, 19.5, -20.0);

    // --- UPPER TWIN FROZEN FALLS CHUTE (y = 18.2 -> 31.5, at z = -31.5) ---
    this.addSolidBox(14, 20, 3.0, -44, 36.0, -35.8, this.cliffMat, 'stone');
    this.createWaterfallWall(1.4, 14.2, 5.8, -47.4, 32.0, -31.5);
    this.createWaterfallWall(1.4, 14.2, 5.8, -40.6, 32.0, -31.5);
    this.entities.addCoinLine(new THREE.Vector3(-44, 20.5, -31.5), new THREE.Vector3(-44, 29.5, -31.5), 4);

    // --- CASCADE CLIFF SHRINE SUMMIT (yTop = 31.5, at (-44, 31.5, -41)) ---
    this.addSolidBox(15, 32, 13, -44, 31.5, -41.5, this.stoneMat, 'stone');
    // Temple columns around Star #2
    for (const [cx, cz] of [
      [-49, -37],
      [-39, -37],
      [-49, -45],
      [-39, -45],
    ]) {
      this.addSolidCylinder(0.65, 0.75, 4.8, 10, cx, 36.3, cz, this.brassMat, 'brass');
    }
    this.addSolidCylinder(1.7, 2.0, 0.4, 12, -44, 31.9, -41.5, this.brassMat, 'brass');

    // ★ POWER STAR #2: Ascent of the Frozen Falls!
    this.entities.registerPowerStar(2, -44, 33.6, -41.5, true);
  }

  private createWaterfallWall(
    w: number,
    h: number,
    d: number,
    x: number,
    yTop: number,
    z: number
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, this.waterfallSolMat);
    mesh.position.set(x, yTop - h * 0.5, z);
    this.scene.add(mesh);
    // Solid & Wall-Kickable ONLY in Luna Phase!
    this.collision.addStaticMesh(mesh, 'luna', 'ice', 'frozen_waterfall');
    this.waterfallMeshes.push(mesh);
  }

  // ==================== ZONE 2: CLOCKWORK TRAIL, BELLTOWER, GEARS & SUMMIT (★ STARS #1 & #5) ====================

  private buildClockworkMountainAndSummit(): void {
    // Central Sculpted Mountain Core Spire supporting the Crown Arena
    this.addSolidCylinder(11.5, 16.5, 37.5, 16, 0, 37.5, -30, this.cliffMat, 'stone');

    // 1. Plaza North-East Trail Archway Ramp: (3, 2.0, 21) -> (15, 6.6, 13)
    this.addRampBetween(2, 2.0, 21, 12, 6.6, 14, 6.2, 1.5, this.stoneMat, 'stone');
    this.addSolidCylinder(7.8, 8.8, 7.2, 16, 16, 6.6, 13, this.grassMat, 'grass');

    // Goombot #2 on Terrace 1 + High Floating Moonstone Alcove above it for Red Coin #4!
    this.entities.addGoombot(16, 6.6, 13, 3.2);
    this.addPhaseBox('luna', 4.5, 0.9, 4.5, 16, 12.2, 13);
    this.entities.addRedCoin(16, 13.5, 13);

    // 2. Ascending Steps & Belltower Approach: (19, 6.6, 11) -> (26, 10.2, 10) -> (33, 14.5, 5) -> (34, 20.0, -9)
    this.addRampBetween(20, 6.6, 12, 26, 10.2, 10, 5.5, 1.4, this.stoneMat, 'stone');
    this.addSolidBox(7.5, 10.8, 7.5, 28, 10.2, 9.5, this.stoneMat, 'stone');

    this.addRampBetween(29.5, 10.2, 6.5, 33.5, 15.0, 1.5, 5.5, 1.4, this.stoneMat, 'stone');
    this.addSolidBox(7.5, 15.5, 7.0, 34.5, 15.0, -1.0, this.stoneMat, 'stone');
    this.addRampBetween(34.5, 15.0, -3.5, 34.0, 20.0, -7.0, 5.8, 1.4, this.stoneMat, 'stone');

    // --- GRAND BELLTOWER BALCONY TERRACE (yTop = 20.0, at (34, 20.0, -11.0)) ---
    this.addSolidBox(15, 20.5, 14, 34, 20.0, -11.0, this.stoneMat, 'stone');
    this.entities.addGoombot(31, 20.0, -13, 2.8);

    // Belltower Archway Roof (yTop = 25.2 -> Red Coin #5 on top!)
    this.addSolidBox(1.4, 4.8, 1.4, 31.2, 24.8, -9.0, this.brassMat, 'brass');
    this.addSolidBox(1.4, 4.8, 1.4, 36.8, 24.8, -9.0, this.brassMat, 'brass');
    this.addSolidBox(7.6, 0.9, 3.6, 34.0, 25.2, -9.0, this.brassMat, 'brass');
    this.entities.addRedCoin(34.0, 26.4, -9.0);

    // ★ POWER STAR #5 Pedestal (Chrono-Ring Sprint Finish!)
    this.addSolidCylinder(1.5, 1.8, 0.35, 12, 34.0, 20.35, -14.5, this.brassMat, 'brass');
    this.entities.registerPowerStar(5, 34.0, 22.0, -14.5, false);

    // --- 3. THE DUAL-PHASE BRIDGE (West from Belltower Balcony along south cliffside: y = 20.0 -> 23.6) ---
    this.addPhaseBox('sol', 5.6, 0.9, 5.4, 23.6, 21.0, -9.5);
    this.addPhaseBox('luna', 5.6, 0.9, 5.4, 16.8, 22.2, -9.5);
    this.addPhaseBox('sol', 5.6, 0.9, 5.4, 10.0, 23.3, -9.5);
    this.entities.addCoinLine(new THREE.Vector3(23.6, 22.0, -9.5), new THREE.Vector3(10.0, 24.3, -9.5), 5);

    // Secret Lower Luna Alcove under Dual-Phase Bridge holding Red Coin #6!
    this.addPhaseBox('luna', 5.4, 0.9, 5.4, 16.8, 17.4, -9.5);
    this.entities.addRedCoin(16.8, 18.7, -9.5);

    // --- 4. GREAT CLOCKWORK GEAR FOUNDRY (y = 23.6 -> 36.6) ---
    // Gear Landing Terrace (3.2, 23.6, -9.5)
    this.addSolidBox(7.8, 24.0, 7.8, 3.2, 23.6, -9.5, this.stoneMat, 'stone');

    // Giant Horizontal Rotating Brass Gear #1 (center (-5.8, 24.8, -10.5), radius 5.6)
    this.createRotatingGear('gear_1', -5.8, 24.8, -10.5, 5.6, 1.0, 0.68);
    // Red Coin #7 perched just above the southern tooth of Gear #1!
    this.entities.addRedCoin(-5.8, 26.3, -5.8);

    // Giant Horizontal Rotating Brass Gear #2 (center (-15.2, 27.2, -14.0), radius 5.6)
    this.createRotatingGear('gear_2', -15.2, 27.2, -14.0, 5.6, 1.0, -0.72);

    // Decorative Vertical Interlocking Gear on mountain cliff wall
    const decorGear = this.buildGearGeometry(4.8, 0.7, 12);
    const dgMesh = new THREE.Mesh(decorGear, this.brassMat);
    dgMesh.rotation.x = Math.PI / 2;
    dgMesh.position.set(-10.5, 30.5, -20.5);
    this.scene.add(dgMesh);
    this.gears.push({ mesh: dgMesh, speed: 0.95, axis: 'z' });

    // Clockwork Piston Elevator carrying player from Gear #2 (y=27.2) up to Summit Rampart (y=36.6)!
    this.createMovingElevator(
      'summit_elevator',
      new THREE.Vector3(-21.2, 27.2, -20.5),
      new THREE.Vector3(0, 9.4, 0),
      5.8,
      1.1,
      5.8,
      1.15
    );

    // Summit Approach Rampart (-21.2, 36.6, -28.2) -> Golden Bridge onto Crown Arena Rim (-14.2, 38.0, -30.0)
    this.addSolidBox(6.8, 14.0, 7.2, -21.2, 36.6, -28.2, this.stoneMat, 'stone');
    this.addRampBetween(-18.2, 36.6, -29.0, -13.8, 38.0, -30.0, 5.5, 1.2, this.brassMat, 'brass');

    // --- 5. CROWN ARENA AT THE SUMMIT (center (0, 38.0, -30), radius 15.5) ---
    this.addSolidCylinder(15.5, 17.0, 4.5, 28, 0, 38.0, -30.0, this.plazaMat, 'stone');

    // Ornate Crown Pillars around Arena perimeter
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const px = Math.cos(a) * 14.2;
      const pz = -30.0 + Math.sin(a) * 14.2;
      this.addSolidCylinder(0.6, 0.75, 3.4, 10, px, 41.4, pz, this.brassMat, 'brass');
    }

    // ★ POWER STAR #1 Pedestal (spawns upon defeating King Horologe!)
    this.entities.registerPowerStar(1, 0, 40.0, -30.0, false);

    // Luna Astral Overlook Pad off north rim of Crown Arena holding Red Coin #8!
    this.addPhaseBox('luna', 5.4, 0.9, 5.4, 0, 38.4, -48.5);
    this.entities.addRedCoin(0, 39.8, -48.5);
  }

  private buildGearGeometry(radius: number, thickness: number, teethCount: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const innerR = radius * 0.84;
    const outerR = radius;
    const step = (Math.PI * 2) / teethCount;

    for (let i = 0; i < teethCount; i++) {
      const a0 = i * step;
      const a1 = a0 + step * 0.22;
      const a2 = a0 + step * 0.52;
      const a3 = a0 + step * 0.74;

      if (i === 0) {
        shape.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
      } else {
        shape.lineTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
      }
      shape.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
      shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
      shape.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, thickness * 0.5, 0);

    // Normalize XZ UVs to [0..1] across the whole gear diameter for a crisp single concentric clockwork dial!
    const posAttr = geo.getAttribute('position');
    const uvAttr = geo.getAttribute('uv');
    if (posAttr && uvAttr) {
      const inv = 1 / (radius * 2);
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vz = posAttr.getZ(i);
        uvAttr.setXY(i, vx * inv + 0.5, vz * inv + 0.5);
      }
      uvAttr.needsUpdate = true;
    }
    return geo;
  }

  private createRotatingGear(
    id: string,
    x: number,
    yTop: number,
    z: number,
    radius: number,
    thickness: number,
    speed: number
  ): void {
    const geo = this.buildGearGeometry(radius, thickness, 12);
    const mesh = new THREE.Mesh(geo, this.brassMat);
    mesh.position.set(x, yTop - thickness, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // 시점 정렬 hub axle
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.6, 12), this.stoneMat);
    hub.position.y = thickness + 0.2;
    mesh.add(hub);

    this.collision.addDynamicMesh(id, mesh, 'both', 'brass', 'gear');
    this.gears.push({ mesh, speed, axis: 'y' });
  }

  private createMovingElevator(
    id: string,
    basePos: THREE.Vector3,
    deltaPos: THREE.Vector3,
    w: number,
    h: number,
    d: number,
    speed: number
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, this.brassMat);
    mesh.position.set(basePos.x, basePos.y - h * 0.5, basePos.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    this.collision.addDynamicMesh(id, mesh, 'both', 'brass', 'elevator');
    this.elevators.push({
      mesh,
      basePos: new THREE.Vector3(basePos.x, basePos.y - h * 0.5, basePos.z),
      deltaPos,
      speed,
      phaseOffset: 0,
      clock: 0,
    });
  }

  // ==================== ZONE 3: 낮과 밤을 잇는 하늘길 (★ STAR #4) ====================

  private buildSkywayOfShiftingPhases(): void {
    // Signpost on East edge of Belltower Balcony (34, 20.0, -11)
    this.entities.addSignpost(
      40.2,
      20.0,
      -10.5,
      -Math.PI / 2,
      '낮과 밤을 잇는 하늘길',
      '달리면서 [Shift + Space]로 구름 사이를 멀리 뛰세요! 공중에서 [F]로 전환하면 낮의 황금 발판과 밤의 푸른 발판이 나타납니다.'
    );

    // Launch Stone Pad extending East from Belltower Balcony
    this.addSolidBox(6.5, 1.8, 6.5, 43.5, 20.2, -11.0, this.stoneMat, 'stone');

    // Long-Jump #1 across cloud gap (9.5u clear gap!) with guiding Coin Arc!
    this.entities.addCoinLine(
      new THREE.Vector3(47.2, 21.2, -11.0),
      new THREE.Vector3(54.8, 21.2, -11.0),
      5,
      2.2
    );
    this.addSolidBox(7.2, 1.8, 7.2, 58.5, 20.2, -11.0, this.stoneMat, 'stone');

    // Ascending Alternating Sol / Luna Skyway Pads heading North!
    this.addPhaseBox('sol', 5.8, 1.0, 5.8, 59.5, 22.6, -20.0);
    this.addPhaseBox('luna', 5.8, 1.0, 5.8, 57.5, 25.0, -29.0);
    this.addPhaseBox('sol', 5.8, 1.0, 5.8, 53.0, 27.4, -37.5);
    this.addPhaseBox('luna', 5.8, 1.0, 5.8, 46.5, 29.8, -44.5);

    this.entities.addYellowCoin(59.5, 23.6, -20.0);
    this.entities.addYellowCoin(57.5, 26.0, -29.0);
    this.entities.addYellowCoin(53.0, 28.4, -37.5);
    this.entities.addYellowCoin(46.5, 30.8, -44.5);

    // Cloud Rest Island (38.5, 31.2, -48.5)
    this.addSolidCylinder(5.2, 3.6, 3.2, 14, 38.5, 31.2, -48.5, this.stoneMat, 'stone');

    // Final Exhilarating Long-Jump + Phase-Shift into the Astral Observatory!
    this.entities.addCoinLine(
      new THREE.Vector3(34.0, 32.2, -50.0),
      new THREE.Vector3(26.5, 33.4, -52.5),
      4,
      2.0
    );
    this.addPhaseBox('luna', 6.5, 1.0, 6.5, 23.5, 32.2, -53.5);
    this.addPhaseBox('sol', 5.8, 1.0, 5.8, 18.0, 34.4, -60.5);

    // --- ASTRAL OBSERVATORY PLATFORM (yTop = 36.2, at (18, 36.2, -69.5)) ---
    this.addSolidCylinder(7.2, 4.8, 3.8, 18, 18.0, 36.2, -69.5, this.plazaMat, 'stone');
    // Celestial Brass Armillary Rings!
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.16, 10, 28), this.brassMat);
    ring1.position.set(18.0, 39.2, -69.5);
    ring1.rotation.x = 0.4;
    this.scene.add(ring1);
    this.gears.push({ mesh: ring1, speed: 0.45, axis: 'y' });

    // ★ POWER STAR #4: Skyway of Shifting Phases!
    this.entities.registerPowerStar(4, 18.0, 38.2, -69.5, true);
  }

  // ==================== LOW-POLY N64 TREES & PUFFY CLOUDS ====================

  private populateDecorTreesAndClouds(): void {
    const trunkMat = this.phaseVisuals.makePhaseMaterial({
      color: 0x7c4a21,
      roughness: 0.85,
      lunaTint: 0x55608a,
    });
    const leafMat = this.phaseVisuals.makePhaseMaterial({
      color: 0x2ea043,
      roughness: 0.65,
      lunaTint: 0x2dd4bf,
      lunaEmissive: 0x062e38,
    });

    const treeSpots: [number, number, number, number][] = [
      [-26, 0.8, 38, 1.1],
      [-32, 0.8, 28, 1.25],
      [27, 0.8, 36, 1.15],
      [34, 0.8, 22, 1.3],
      [-14, 0.8, 48, 1.0],
      [15, 0.8, 48, 1.05],
      [21, 6.6, 17, 0.9],
      [-48, 3.2, 6, 1.0],
    ];

    for (const [tx, ty, tz, scale] of treeSpots) {
      const g = new THREE.Group();
      g.position.set(tx, ty, tz);
      g.scale.setScalar(scale);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.52, 2.2, 8), trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      g.add(trunk);

      for (let layer = 0; layer < 3; layer++) {
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(1.85 - layer * 0.38, 2.1, 8),
          leafMat
        );
        cone.position.y = 2.5 + layer * 1.15;
        cone.castShadow = true;
        g.add(cone);
      }
      this.scene.add(g);
    }

    // Fluffy N64 Puffy Sky Clouds drifting around the sanctuary!
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x334155,
      emissiveIntensity: 0.25,
      roughness: 0.9,
    });
    for (let i = 0; i < 14; i++) {
      const cg = new THREE.Group();
      const angle = (i / 14) * Math.PI * 2;
      const rad = 75 + (i % 3) * 24;
      cg.position.set(Math.cos(angle) * rad, 22 + (i % 4) * 9, Math.sin(angle) * rad - 15);
      for (let p = 0; p < 3; p++) {
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(3.5 - p * 0.6, 1), cloudMat);
        puff.position.set((p - 1) * 2.8, (p % 2) * 0.8, 0);
        puff.scale.set(1.3, 0.68, 1.0);
        cg.add(puff);
      }
      this.cloudGroup.add(cg);
    }
    this.scene.add(this.cloudGroup);
  }

  // ==================== UPDATE PHASE VISUALS & DYNAMIC PLATFORMS ====================

  public applyPhaseState(phase: WorldPhase): void {
    // 1. Toggle Sol-only and Luna-only platform opacity & ghost outlines!
    for (const p of this.phasePlatforms) {
      const isSolid = p.rule === phase;
      p.solidMat.opacity = isSolid ? 0.98 : 0.14;
      p.solidMesh.castShadow = isSolid;
      p.ghostWire.visible = !isSolid;
    }

    // 2. Swap Waterfalls between Rushing Liquid (Sol) and Solid Faceted Crystal Ice (Luna)!
    const wfMat = phase === 'luna' ? this.waterfallIceMat : this.waterfallSolMat;
    for (const wf of this.waterfallMeshes) {
      wf.material = wfMat;
    }

    // 3. Toggle 3D Celestial Sun / Moon
    this.skySunGroup.visible = phase === 'sol';
    this.skyMoonGroup.visible = phase === 'luna';
  }

  public update(dt: number, phase: WorldPhase, lunaMix: number): void {
    // Scroll waterfalls in Sol; freeze crystal still in Luna!
    if (phase === 'sol') {
      this.waterfallTex.offset.y += dt * 1.85;
    }

    // 회전 Clockwork Gears & Elevators in Sol; lock gears in place in Luna!
    if (phase === 'sol') {
      for (const g of this.gears) {
        if (g.axis === 'y') g.mesh.rotation.y += g.speed * dt;
        else g.mesh.rotation.z += g.speed * dt;
      }
      for (const e of this.elevators) {
        e.clock += dt * e.speed;
        const t = (Math.sin(e.clock + e.phaseOffset) + 1) * 0.5;
        e.mesh.position.set(
          e.basePos.x + e.deltaPos.x * t,
          e.basePos.y + e.deltaPos.y * t,
          e.basePos.z + e.deltaPos.z * t
        );
      }
      this.sundialShadowHand.rotation.y += dt * 0.25;
    }

    // Drift sky clouds gently
    this.cloudGroup.rotation.y += dt * 0.018;

    // Crossfade night starfield & deep twilight ocean
    this.starfieldMat.opacity = lunaMix * 0.92;
    this.oceanMat.color.lerpColors(new THREE.Color(0x1ea7e1), new THREE.Color(0x0f2557), lunaMix);
    this.oceanMat.emissive.lerpColors(new THREE.Color(0x053a5e), new THREE.Color(0x0c1e4a), lunaMix);
  }
}
