import * as THREE from 'three';
import { CollisionWorld } from '../physics/CollisionWorld';
import { WorldPhase } from '../types';

export class CameraRig {
  public yaw = 0; // Radians, 0 = looking from +Z toward -Z
  public pitch = 0.34;
  public targetYaw = 0;
  public targetPitch = 0.34;
  public distance = 11.8;
  public targetDistance = 11.8;

  private focusPoint = new THREE.Vector3(0, 3.5, 36);
  private smoothGroundY = 2.0;
  private shakeTimer = 0;
  private shakeIntensity = 0;

  // Cinematic modes
  private flyoverTimer = 0;
  private flyoverDuration = 0;
  private flyoverFromPos = new THREE.Vector3();
  private flyoverLookAt = new THREE.Vector3();

  private starCelebration = false;
  private starOrbitAngle = 0;

  constructor(public readonly camera: THREE.PerspectiveCamera) {}

  public resetBehindPlayer(playerPos: THREE.Vector3, playerFacingYaw: number): void {
    // Player facingYaw = atan2(sin, cos) of forward vector. Put camera behind player!
    this.yaw = playerFacingYaw + Math.PI;
    this.targetYaw = this.yaw;
    this.pitch = 0.34;
    this.targetPitch = 0.34;
    this.smoothGroundY = playerPos.y;
    this.focusPoint.set(playerPos.x, playerPos.y + 1.6, playerPos.z);
    this.starCelebration = false;
    this.flyoverTimer = 0;
  }

  public onMouseMove(dx: number, dy: number): void {
    if (this.starCelebration || this.flyoverTimer > 0) return;
    const sens = 0.0028;
    this.targetYaw -= dx * sens;
    this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * sens, 0.06, 1.18);
  }

  public snapLakitu(stepDir: -1 | 1): void {
    if (this.starCelebration) return;
    const snap = Math.PI / 4;
    this.targetYaw = Math.round((this.targetYaw + stepDir * snap) / snap) * snap;
  }

  public centerBehind(playerFacingYaw: number): void {
    if (this.starCelebration) return;
    const desired = playerFacingYaw + Math.PI;
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.targetYaw = this.yaw + diff;
    this.targetPitch = 0.32;
  }

  public zoomStep(): number {
    if (this.targetDistance < 10) {
      this.targetDistance = 12.2;
    } else if (this.targetDistance < 14) {
      this.targetDistance = 16.5;
    } else {
      this.targetDistance = 8.6;
    }
    return this.targetDistance;
  }

  public addShake(intensity: number, duration = 0.22): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeTimer = Math.max(this.shakeTimer, duration);
  }

  public startMissionFlyover(camPos: THREE.Vector3, lookTarget: THREE.Vector3, duration = 2.1): void {
    this.flyoverFromPos.copy(camPos);
    this.flyoverLookAt.copy(lookTarget);
    this.flyoverDuration = duration;
    this.flyoverTimer = duration;
  }

  public startStarCelebration(playerFacingYaw: number): void {
    this.starCelebration = true;
    this.starOrbitAngle = playerFacingYaw;
  }

  public stopStarCelebration(): void {
    this.starCelebration = false;
  }

  public getForwardXZ(out: THREE.Vector3): THREE.Vector3 {
    // Camera looks from spherical offset toward focusPoint
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    return out;
  }

  public getRightXZ(out: THREE.Vector3): THREE.Vector3 {
    out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    return out;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    grounded: boolean,
    speedRatio: number,
    collision: CollisionWorld,
    phase: WorldPhase
  ): void {
    // Celebratory close-up Star Dance camera
    if (this.starCelebration) {
      this.starOrbitAngle += dt * 0.85;
      const targetFocus = new THREE.Vector3(playerPos.x, playerPos.y + 1.25, playerPos.z);
      this.focusPoint.lerp(targetFocus, Math.min(1, dt * 8));
      const camPos = new THREE.Vector3(
        this.focusPoint.x + Math.sin(this.starOrbitAngle) * 4.6,
        this.focusPoint.y + 1.1,
        this.focusPoint.z + Math.cos(this.starOrbitAngle) * 4.6
      );
      this.camera.position.lerp(camPos, Math.min(1, dt * 7));
      this.camera.lookAt(this.focusPoint);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 52, Math.min(1, dt * 6));
      this.camera.updateProjectionMatrix();
      return;
    }

    // Brief intro mission flyover blending smoothly back to gameplay camera
    if (this.flyoverTimer > 0) {
      this.flyoverTimer = Math.max(0, this.flyoverTimer - dt);
      const t = 1 - this.flyoverTimer / this.flyoverDuration; // 0 -> 1
      if (t < 0.68) {
        const orbit = this.flyoverFromPos.clone();
        orbit.x += Math.sin(t * 2.5) * 3.2;
        this.camera.position.copy(orbit);
        this.camera.lookAt(this.flyoverLookAt);
        return;
      }
      // Last 32%: blend smoothly into behind-player rig!
    }

    // Smooth yaw/pitch/distance interpolation
    const rotSmooth = 1 - Math.exp(-14 * dt);
    this.yaw += (this.targetYaw - this.yaw) * rotSmooth;
    this.pitch += (this.targetPitch - this.pitch) * rotSmooth;
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-8 * dt));

    // SM64 steady ground-plane tracking: fast when grounded or falling low, gentle on mid-air hops
    if (grounded) {
      this.smoothGroundY = THREE.MathUtils.lerp(this.smoothGroundY, playerPos.y, 1 - Math.exp(-12 * dt));
    } else if (playerPos.y > this.smoothGroundY + 3.4) {
      this.smoothGroundY = THREE.MathUtils.lerp(
        this.smoothGroundY,
        playerPos.y - 2.2,
        1 - Math.exp(-7 * dt)
      );
    } else if (playerPos.y < this.smoothGroundY - 1.2) {
      this.smoothGroundY = THREE.MathUtils.lerp(this.smoothGroundY, playerPos.y, 1 - Math.exp(-10 * dt));
    }

    const desiredFocus = new THREE.Vector3(playerPos.x, this.smoothGroundY + 1.55, playerPos.z);
    this.focusPoint.x = THREE.MathUtils.lerp(this.focusPoint.x, desiredFocus.x, 1 - Math.exp(-16 * dt));
    this.focusPoint.z = THREE.MathUtils.lerp(this.focusPoint.z, desiredFocus.z, 1 - Math.exp(-16 * dt));
    this.focusPoint.y = THREE.MathUtils.lerp(this.focusPoint.y, desiredFocus.y, 1 - Math.exp(-11 * dt));

    const horizDist = Math.cos(this.pitch) * this.distance;
    const vertDist = Math.sin(this.pitch) * this.distance;

    const desiredPos = new THREE.Vector3(
      this.focusPoint.x + Math.sin(this.yaw) * horizDist,
      this.focusPoint.y + vertDist,
      this.focusPoint.z + Math.cos(this.yaw) * horizDist
    );

    // Raycast from player torso so camera never clips behind walls
    const rayOrigin = new THREE.Vector3(playerPos.x, playerPos.y + 1.35, playerPos.z);
    const safePos = collision.raycastCamera(rayOrigin, desiredPos, phase);

    if (this.flyoverTimer > 0) {
      const blend = (1 - this.flyoverTimer / this.flyoverDuration - 0.68) / 0.32;
      const eased = THREE.MathUtils.smoothstep(blend, 0, 1);
      this.camera.position.lerpVectors(this.flyoverFromPos, safePos, eased);
      const look = new THREE.Vector3().lerpVectors(this.flyoverLookAt, this.focusPoint, eased);
      this.camera.lookAt(look);
    } else {
      this.camera.position.copy(safePos);
      if (this.shakeTimer > 0) {
        this.shakeTimer = Math.max(0, this.shakeTimer - dt);
        const s = this.shakeIntensity * (this.shakeTimer / 0.25);
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
      }
      this.camera.lookAt(this.focusPoint);
    }

    // Subtle dynamic FOV boost when Long-Jumping / Sprinting fast!
    const desiredFov = 58 + Math.max(0, speedRatio - 0.85) * 14;
    if (Math.abs(this.camera.fov - desiredFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, 1 - Math.exp(-7 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
