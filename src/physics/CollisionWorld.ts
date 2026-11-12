import * as THREE from 'three';
import { PhaseRule, SurfaceType, WorldPhase } from '../types';

export interface ColTri {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  kind: 'floor' | 'wall' | 'ceil';
  phaseRule: PhaseRule;
  surface: SurfaceType;
  tag?: string;
}

export interface DynamicBody {
  id: string;
  object: THREE.Object3D;
  localTris: ColTri[];
  phaseRule: PhaseRule;
  surface: SurfaceType;
  active: boolean;
  tag?: string;
  prevMatrix: THREE.Matrix4;
  prevMatrixInv: THREE.Matrix4;
  currMatrix: THREE.Matrix4;
  currMatrixInv: THREE.Matrix4;
  currNormalMatrix: THREE.Matrix3;
  worldBox: THREE.Box3;
  localBox: THREE.Box3;
}

export interface FloorHit {
  y: number;
  normal: THREE.Vector3;
  surface: SurfaceType;
  tag?: string;
  dynamicBody?: DynamicBody;
}

export interface WallHit {
  normal: THREE.Vector3;
  surface: SurfaceType;
  tag?: string;
}

const CELL_SIZE = 8.0;

function isPhaseActive(rule: PhaseRule, current: WorldPhase): boolean {
  return rule === 'both' || rule === current;
}

export class CollisionWorld {
  private grid = new Map<string, ColTri[]>();
  private allStaticTris: ColTri[] = [];
  private dynamicBodies: DynamicBody[] = [];

  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private tmpClosest = new THREE.Vector3();
  private ray = new THREE.Ray();
  private rayHit = new THREE.Vector3();

  private cellKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  public addStaticMesh(
    mesh: THREE.Mesh,
    phaseRule: PhaseRule = 'both',
    surface: SurfaceType = 'stone',
    tag?: string
  ): void {
    mesh.updateWorldMatrix(true, false);
    const tris = this.extractTriangles(mesh.geometry, mesh.matrixWorld, phaseRule, surface, tag);
    for (const tri of tris) {
      this.allStaticTris.push(tri);
      const minCx = Math.floor(tri.minX / CELL_SIZE);
      const maxCx = Math.floor(tri.maxX / CELL_SIZE);
      const minCz = Math.floor(tri.minZ / CELL_SIZE);
      const maxCz = Math.floor(tri.maxZ / CELL_SIZE);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = this.cellKey(cx, cz);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(tri);
        }
      }
    }
  }

  public addDynamicMesh(
    id: string,
    mesh: THREE.Mesh,
    phaseRule: PhaseRule = 'both',
    surface: SurfaceType = 'brass',
    tag?: string
  ): DynamicBody {
    mesh.updateWorldMatrix(true, false);
    const identity = new THREE.Matrix4();
    const localTris = this.extractTriangles(mesh.geometry, identity, phaseRule, surface, tag);
    const localBox = new THREE.Box3();
    for (const t of localTris) {
      localBox.expandByPoint(t.a);
      localBox.expandByPoint(t.b);
      localBox.expandByPoint(t.c);
    }
    localBox.expandByScalar(0.5);

    const body: DynamicBody = {
      id,
      object: mesh,
      localTris,
      phaseRule,
      surface,
      active: true,
      tag,
      prevMatrix: mesh.matrixWorld.clone(),
      prevMatrixInv: mesh.matrixWorld.clone().invert(),
      currMatrix: mesh.matrixWorld.clone(),
      currMatrixInv: mesh.matrixWorld.clone().invert(),
      currNormalMatrix: new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
      localBox,
      worldBox: localBox.clone().applyMatrix4(mesh.matrixWorld),
    };
    this.dynamicBodies.push(body);
    return body;
  }

  public removeDynamicBody(id: string): void {
    const idx = this.dynamicBodies.findIndex((b) => b.id === id);
    if (idx >= 0) this.dynamicBodies.splice(idx, 1);
  }

  public syncDynamicBodiesBeginStep(): void {
    for (const b of this.dynamicBodies) {
      if (!b.active) continue;
      b.prevMatrix.copy(b.currMatrix);
      b.prevMatrixInv.copy(b.currMatrixInv);
    }
  }

  public syncDynamicBodiesEndStep(): void {
    for (const b of this.dynamicBodies) {
      if (!b.active) continue;
      b.object.updateWorldMatrix(true, false);
      b.currMatrix.copy(b.object.matrixWorld);
      b.currMatrixInv.copy(b.currMatrix).invert();
      b.currNormalMatrix.getNormalMatrix(b.currMatrix);
      b.worldBox.copy(b.localBox).applyMatrix4(b.currMatrix);
    }
  }

  public computePlatformDelta(
    body: DynamicBody,
    worldPos: THREE.Vector3,
    outDeltaPos: THREE.Vector3
  ): number {
    // Map worldPos from prev frame local -> curr frame world
    this.tmpA.copy(worldPos).applyMatrix4(body.prevMatrixInv);
    this.tmpB.copy(this.tmpA).applyMatrix4(body.currMatrix);
    outDeltaPos.subVectors(this.tmpB, worldPos);

    // Compute delta yaw for smooth character rotation on spinning gears
    this.tmpA.set(0, 0, 1).transformDirection(body.prevMatrix);
    this.tmpB.set(0, 0, 1).transformDirection(body.currMatrix);
    const yawPrev = Math.atan2(this.tmpA.x, this.tmpA.z);
    const yawCurr = Math.atan2(this.tmpB.x, this.tmpB.z);
    let dYaw = yawCurr - yawPrev;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    return dYaw;
  }

  private extractTriangles(
    geometry: THREE.BufferGeometry,
    matrix: THREE.Matrix4,
    phaseRule: PhaseRule,
    surface: SurfaceType,
    tag?: string
  ): ColTri[] {
    const pos = geometry.getAttribute('position');
    if (!pos) return [];
    const index = geometry.getIndex();
    const out: ColTri[] = [];

    const pushTri = (i0: number, i1: number, i2: number) => {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0).applyMatrix4(matrix);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i1).applyMatrix4(matrix);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i2).applyMatrix4(matrix);

      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const normal = new THREE.Vector3().crossVectors(ab, ac);
      const lenSq = normal.lengthSq();
      if (lenSq < 1e-8) return;
      normal.multiplyScalar(1 / Math.sqrt(lenSq));

      const kind: 'floor' | 'wall' | 'ceil' =
        normal.y > 0.46 ? 'floor' : normal.y < -0.46 ? 'ceil' : 'wall';

      out.push({
        a,
        b,
        c,
        normal,
        minX: Math.min(a.x, b.x, c.x),
        maxX: Math.max(a.x, b.x, c.x),
        minY: Math.min(a.y, b.y, c.y),
        maxY: Math.max(a.y, b.y, c.y),
        minZ: Math.min(a.z, b.z, c.z),
        maxZ: Math.max(a.z, b.z, c.z),
        kind,
        phaseRule,
        surface,
        tag,
      });
    };

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        pushTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        pushTri(i, i + 1, i + 2);
      }
    }
    return out;
  }

  /**
   * Exact 2D XZ triangle containment + plane height interpolation.
   */
  private sampleFloorTriAtXZ(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    normal: THREE.Vector3,
    x: number,
    z: number
  ): number | null {
    const v0x = c.x - a.x;
    const v0z = c.z - a.z;
    const v1x = b.x - a.x;
    const v1z = b.z - a.z;
    const v2x = x - a.x;
    const v2z = z - a.z;

    const dot00 = v0x * v0x + v0z * v0z;
    const dot01 = v0x * v1x + v0z * v1z;
    const dot02 = v0x * v2x + v0z * v2z;
    const dot11 = v1x * v1x + v1z * v1z;
    const dot12 = v1x * v2x + v1z * v2z;

    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-8) return null;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;

    const eps = -0.025;
    if (u >= eps && v >= eps && u + v <= 1 - eps) {
      if (Math.abs(normal.y) < 0.05) return null;
      const d = -(normal.x * a.x + normal.y * a.y + normal.z * a.z);
      return -(normal.x * x + normal.z * z + d) / normal.y;
    }
    return null;
  }

  public findFloor(
    x: number,
    y: number,
    z: number,
    stepUp: number,
    phase: WorldPhase,
    footRadius = 0.28
  ): FloorHit | null {
    const offsets: [number, number][] = [
      [0, 0],
      [footRadius, 0],
      [-footRadius, 0],
      [0, footRadius],
      [0, -footRadius],
    ];

    let best: FloorHit | null = null;
    const maxAllowedY = y + stepUp;

    for (const [ox, oz] of offsets) {
      const sx = x + ox;
      const sz = z + oz;
      const cx = Math.floor(sx / CELL_SIZE);
      const cz = Math.floor(sz / CELL_SIZE);
      const bucket = this.grid.get(this.cellKey(cx, cz));

      if (bucket) {
        for (const tri of bucket) {
          if (tri.kind !== 'floor') continue;
          if (!isPhaseActive(tri.phaseRule, phase)) continue;
          if (sx < tri.minX - 0.05 || sx > tri.maxX + 0.05 || sz < tri.minZ - 0.05 || sz > tri.maxZ + 0.05) continue;
          if (tri.minY > maxAllowedY) continue;
          if (best && tri.maxY < best.y) continue;

          const hitY = this.sampleFloorTriAtXZ(tri.a, tri.b, tri.c, tri.normal, sx, sz);
          if (hitY !== null && hitY <= maxAllowedY) {
            if (!best || hitY > best.y) {
              best = {
                y: hitY,
                normal: tri.normal.clone(),
                surface: tri.surface,
                tag: tri.tag,
              };
            }
          }
        }
      }

      // Check active dynamic platforms
      for (const body of this.dynamicBodies) {
        if (!body.active || !isPhaseActive(body.phaseRule, phase)) continue;
        if (
          sx < body.worldBox.min.x ||
          sx > body.worldBox.max.x ||
          sz < body.worldBox.min.z ||
          sz > body.worldBox.max.z ||
          body.worldBox.min.y > maxAllowedY
        ) {
          continue;
        }

        for (const lt of body.localTris) {
          this.tmpN.copy(lt.normal).applyMatrix3(body.currNormalMatrix).normalize();
          if (this.tmpN.y <= 0.46) continue;
          this.tmpA.copy(lt.a).applyMatrix4(body.currMatrix);
          this.tmpB.copy(lt.b).applyMatrix4(body.currMatrix);
          this.tmpC.copy(lt.c).applyMatrix4(body.currMatrix);

          const hitY = this.sampleFloorTriAtXZ(this.tmpA, this.tmpB, this.tmpC, this.tmpN, sx, sz);
          if (hitY !== null && hitY <= maxAllowedY) {
            if (!best || hitY > best.y) {
              best = {
                y: hitY,
                normal: this.tmpN.clone(),
                surface: body.surface,
                tag: body.tag,
                dynamicBody: body,
              };
            }
          }
        }
      }

      // If center probe already caught a floor right near our feet, no need to let side probes pull us higher onto an adjacent step prematurely
      if (ox === 0 && oz === 0 && best && y - best.y < 1.1) {
        break;
      }
    }

    return best;
  }

  public findCeiling(
    x: number,
    yFeet: number,
    yHead: number,
    z: number,
    phase: WorldPhase
  ): number | null {
    const cx = Math.floor(x / CELL_SIZE);
    const cz = Math.floor(z / CELL_SIZE);
    const bucket = this.grid.get(this.cellKey(cx, cz));
    let lowestCeil: number | null = null;

    if (bucket) {
      for (const tri of bucket) {
        if (tri.kind !== 'ceil') continue;
        if (!isPhaseActive(tri.phaseRule, phase)) continue;
        if (tri.maxY < yFeet + 0.5 || tri.minY > yHead + 0.3) continue;
        const cy = this.sampleFloorTriAtXZ(tri.a, tri.b, tri.c, tri.normal, x, z);
        if (cy !== null && cy >= yFeet + 0.5 && cy <= yHead + 0.2) {
          if (lowestCeil === null || cy < lowestCeil) {
            lowestCeil = cy;
          }
        }
      }
    }
    return lowestCeil;
  }

  /**
   * Resolves horizontal cylinder pushout against active walls (both static & dynamic).
   * Returns strongest wall hit for SM64 Wall-Slide / Wall-Kick!
   */
  public resolveWalls(
    pos: THREE.Vector3,
    radius: number,
    height: number,
    phase: WorldPhase
  ): WallHit | null {
    const sampleHeights = [pos.y + 0.52, pos.y + height * 0.78];
    let primaryHit: WallHit | null = null;

    const minCx = Math.floor((pos.x - radius - 0.5) / CELL_SIZE);
    const maxCx = Math.floor((pos.x + radius + 0.5) / CELL_SIZE);
    const minCz = Math.floor((pos.z - radius - 0.5) / CELL_SIZE);
    const maxCz = Math.floor((pos.z + radius + 0.5) / CELL_SIZE);

    const checked = new Set<ColTri>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.grid.get(this.cellKey(cx, cz));
        if (!bucket) continue;
        for (const tri of bucket) {
          if (tri.kind !== 'wall' || checked.has(tri)) continue;
          checked.add(tri);
          if (!isPhaseActive(tri.phaseRule, phase)) continue;
          if (tri.maxY < pos.y + 0.35 || tri.minY > pos.y + height) continue;

          const hit = this.pushSphereOutOfWallTri(
            pos,
            sampleHeights,
            radius,
            tri.a,
            tri.b,
            tri.c,
            tri.normal,
            tri.surface,
            tri.tag
          );
          if (hit) primaryHit = hit;
        }
      }
    }

    // Dynamic wall triangles (Chrono-Echo statue, gears, moving blocks, King Horologe!)
    for (const body of this.dynamicBodies) {
      if (!body.active || !isPhaseActive(body.phaseRule, phase)) continue;
      if (
        pos.x + radius < body.worldBox.min.x ||
        pos.x - radius > body.worldBox.max.x ||
        pos.z + radius < body.worldBox.min.z ||
        pos.z - radius > body.worldBox.max.z ||
        pos.y + height < body.worldBox.min.y ||
        pos.y > body.worldBox.max.y
      ) {
        continue;
      }

      for (const lt of body.localTris) {
        this.tmpN.copy(lt.normal).applyMatrix3(body.currNormalMatrix).normalize();
        if (Math.abs(this.tmpN.y) > 0.46) continue;
        this.tmpA.copy(lt.a).applyMatrix4(body.currMatrix);
        this.tmpB.copy(lt.b).applyMatrix4(body.currMatrix);
        this.tmpC.copy(lt.c).applyMatrix4(body.currMatrix);

        const hit = this.pushSphereOutOfWallTri(
          pos,
          sampleHeights,
          radius,
          this.tmpA,
          this.tmpB,
          this.tmpC,
          this.tmpN,
          body.surface,
          body.tag
        );
        if (hit) primaryHit = hit;
      }
    }

    return primaryHit;
  }

  private pushSphereOutOfWallTri(
    pos: THREE.Vector3,
    sampleHeights: number[],
    radius: number,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    normal: THREE.Vector3,
    surface: SurfaceType,
    tag?: string
  ): WallHit | null {
    let hitResult: WallHit | null = null;
    const triangle = new THREE.Triangle(a, b, c);

    for (const sy of sampleHeights) {
      const probe = this.tmpClosest.set(pos.x, sy, pos.z);
      const closest = new THREE.Vector3();
      triangle.closestPointToPoint(probe, closest);

      const dx = pos.x - closest.x;
      const dy = sy - closest.y;
      const dz = pos.z - closest.z;
      if (Math.abs(dy) > 0.55) continue;

      const horizDistSq = dx * dx + dz * dz;
      if (horizDistSq < radius * radius) {
        const horizDist = Math.sqrt(horizDistSq);
        let nx = normal.x;
        let nz = normal.z;
        const nLen = Math.hypot(nx, nz);
        if (nLen > 1e-4) {
          nx /= nLen;
          nz /= nLen;
        } else if (horizDist > 1e-4) {
          nx = dx / horizDist;
          nz = dz / horizDist;
        } else {
          nx = 0;
          nz = 1;
        }

        // Make sure we push toward the front side or away from closest point
        if (horizDist > 1e-4 && dx * nx + dz * nz < 0) {
          nx = -nx;
          nz = -nz;
        }

        const push = radius - horizDist;
        pos.x += nx * push;
        pos.z += nz * push;

        hitResult = {
          normal: new THREE.Vector3(nx, 0, nz),
          surface,
          tag,
        };
      }
    }
    return hitResult;
  }

  /**
   * Lakitu camera anti-clipping raycast from player head toward desired camera position.
   */
  public raycastCamera(
    origin: THREE.Vector3,
    desiredCamPos: THREE.Vector3,
    phase: WorldPhase
  ): THREE.Vector3 {
    const dir = new THREE.Vector3().subVectors(desiredCamPos, origin);
    const maxDist = dir.length();
    if (maxDist < 0.01) return desiredCamPos.clone();
    dir.multiplyScalar(1 / maxDist);

    this.ray.set(origin, dir);

    const minCx = Math.floor(Math.min(origin.x, desiredCamPos.x) / CELL_SIZE);
    const maxCx = Math.floor(Math.max(origin.x, desiredCamPos.x) / CELL_SIZE);
    const minCz = Math.floor(Math.min(origin.z, desiredCamPos.z) / CELL_SIZE);
    const maxCz = Math.floor(Math.max(origin.z, desiredCamPos.z) / CELL_SIZE);

    let closestDist = maxDist;
    const seen = new Set<ColTri>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.grid.get(this.cellKey(cx, cz));
        if (!bucket) continue;
        for (const tri of bucket) {
          if (seen.has(tri)) continue;
          seen.add(tri);
          if (!isPhaseActive(tri.phaseRule, phase)) continue;
          // Ignore water/decor tags if any
          const hit = this.ray.intersectTriangle(tri.a, tri.b, tri.c, false, this.rayHit);
          if (hit) {
            const d = origin.distanceTo(hit);
            if (d < closestDist && d > 0.8) {
              closestDist = d;
            }
          }
        }
      }
    }

    if (closestDist < maxDist) {
      const safeDist = Math.max(2.6, closestDist - 0.55);
      return origin.clone().addScaledVector(dir, safeDist);
    }
    return desiredCamPos.clone();
  }
}
