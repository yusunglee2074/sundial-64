import * as THREE from 'three';
import { SoundEngine } from './audio/SoundEngine';
import { PhaseVisualManager } from './graphics/PhaseShader';
import { ParticleSystem } from './graphics/ParticleSystem';
import { CollisionWorld } from './physics/CollisionWorld';
import { CameraRig } from './world/CameraRig';
import { Player, InputState } from './entities/Player';
import { StageEntities, Signpost } from './entities/StageEntities';
import { StageBuilder } from './world/StageBuilder';
import { MISSIONS, StarId, WorldPhase } from './types';

class Sundial64Game {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  private sound = new SoundEngine();
  private phaseVisuals = new PhaseVisualManager();
  private particles: ParticleSystem;
  private collision = new CollisionWorld();
  private cameraRig: CameraRig;
  private player: Player;
  private entities: StageEntities;
  private stage: StageBuilder;

  public phase: WorldPhase = 'sol';
  public selectedMissionId: StarId = 1;
  private inPaintingMenu = true;
  private starModalOpen = false;

  // Input state
  private keys = new Set<string>();
  private oneShot = {
    jump: false,
    crouch: false,
    dive: false,
    echo: false,
  };
  private isDraggingCamera = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // 그림으로 Ripple Canvas
  private paintingCanvas: HTMLCanvasElement;
  private paintingCtx: CanvasRenderingContext2D;
  private ripples: { x: number; y: number; r: number; alpha: number }[] = [];

  // HUD Cache
  private lastHealthRendered = -1;
  private moveBannerTimeout: number | null = null;

  // Fixed physics accumulator
  private lastFrameTime = performance.now();
  private physAccum = 0;
  private readonly fixedDt = 1 / 120;

  private solSky = new THREE.Color(0x52b6ff);
  private lunaSky = new THREE.Color(0x09112e);
  private currentSky = new THREE.Color(0x52b6ff);

  constructor() {
    this.container = document.getElementById('game-container')!;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.currentSky;
    this.scene.fog = new THREE.FogExp2(0x52b6ff, 0.0042);

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 420);
    this.cameraRig = new CameraRig(this.camera);

    // Lighting
    this.hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x3f6212, 0.85);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff4d6, 1.85);
    this.dirLight.position.set(48, 86, 54);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 220;
    const sc = 78;
    this.dirLight.shadow.camera.left = -sc;
    this.dirLight.shadow.camera.right = sc;
    this.dirLight.shadow.camera.top = sc;
    this.dirLight.shadow.camera.bottom = -sc;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // World & Gameplay Systems
    this.particles = new ParticleSystem(this.scene);
    this.entities = new StageEntities(this.scene, this.particles, this.sound);
    this.stage = new StageBuilder(this.scene, this.collision, this.phaseVisuals, this.entities);
    this.player = new Player(this.scene, this.collision, this.particles, this.sound);

    this.stage.applyPhaseState(this.phase);
    this.collision.syncDynamicBodiesEndStep();
    this.cameraRig.resetBehindPlayer(this.player.pos, this.player.facingYaw);

    // 그림으로 canvas init
    this.paintingCanvas = document.getElementById('painting-canvas') as HTMLCanvasElement;
    this.paintingCtx = this.paintingCanvas.getContext('2d')!;

    this.wireCallbacks();
    this.setupUI();
    this.setupInputs();

    // Auto-start support via query param (?autostart=1)
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      this.enterStageFromPainting(false);
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  private wireCallbacks(): void {
    this.player.onMoveBanner = (label, color) => this.showMoveBanner(label, color);
    this.player.onGroundPoundImpact = (pos) => {
      this.cameraRig.addShake(0.32, 0.2);
      this.entities.handleGroundPoundAt(pos, this.phase);
    };

    this.entities.onBanner = (label, color) => this.showMoveBanner(label, color);
    this.entities.onStarSpawned = (_id, title) => {
      this.showMoveBanner(title, '#fde047');
      this.cameraRig.addShake(0.28, 0.28);
    };
    this.entities.onStarCollected = (id) => this.handleStarCollected(id);
    this.entities.onNearbySign = (sign) => this.updateSignDialog(sign);
  }

  // ==================== PHASE SHIFT (CORE TWIST!) ====================

  public togglePhase(): void {
    if (this.inPaintingMenu || this.starModalOpen) return;
    this.phase = this.phase === 'sol' ? 'luna' : 'sol';

    this.phaseVisuals.triggerPhaseWave(this.phase, this.player.pos);
    this.stage.applyPhaseState(this.phase);
    this.sound.setPhase(this.phase, true);
    this.particles.spawnShockRing(
      this.player.pos.clone().add(new THREE.Vector3(0, 0.8, 0)),
      this.phase === 'luna' ? 0x38bdf8 : 0xfbbf24,
      6.5,
      0.42
    );

    this.updatePhaseHUD();
    if (!this.player.grounded) {
      this.player.registerFlowMove(
        this.phase === 'luna' ? '☾ 공중에서 밤으로!' : '☀ 공중에서 낮으로!',
        this.phase === 'luna' ? '#67e8f9' : '#fde047'
      );
    } else {
      this.showMoveBanner(
        this.phase === 'luna'
          ? '☾ 밤의 세계 — 폭포와 톱니가 멈췄습니다!'
          : '☀ 낮의 세계 — 태엽이 움직입니다!',
        this.phase === 'luna' ? '#67e8f9' : '#fde047'
      );
    }
  }

  // ==================== UI & PAINTING SELECT ====================

  private setupUI(): void {
    this.renderMissionSelector();
    this.renderTrackerList();
    this.renderPowerPie(8);
    this.updatePhaseHUD();

    document.getElementById('enter-stage-btn')!.addEventListener('click', () => {
      this.enterStageFromPainting(true);
    });
    document.getElementById('painting-trigger')!.addEventListener('click', () => {
      this.enterStageFromPainting(true);
    });
    this.paintingCanvas.addEventListener('mousemove', (e) => {
      const rect = this.paintingCanvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.paintingCanvas.width;
      const y = ((e.clientY - rect.top) / rect.height) * this.paintingCanvas.height;
      if (Math.random() < 0.45) {
        this.ripples.push({ x, y, r: 4, alpha: 0.75 });
      }
    });

    document.getElementById('phase-hud-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePhase();
    });

    // Utility buttons
    const movesPanel = document.getElementById('moveset-panel')!;
    const trackerPanel = document.getElementById('tracker-panel')!;

    document.getElementById('btn-moves')!.addEventListener('click', (e) => {
      e.stopPropagation();
      movesPanel.classList.toggle('hidden');
      trackerPanel.classList.add('hidden');
      this.entities.setRadarVisible(false);
    });
    document.getElementById('close-moves-btn')!.addEventListener('click', () => {
      movesPanel.classList.add('hidden');
    });

    document.getElementById('btn-missions')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTrackerPanel();
    });
    document.getElementById('close-tracker-btn')!.addEventListener('click', () => {
      trackerPanel.classList.add('hidden');
      this.entities.setRadarVisible(false);
    });

    const audioBtn = document.getElementById('btn-audio')!;
    audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const muted = this.sound.toggleMute();
      audioBtn.innerHTML = `<kbd>M</kbd> 소리: ${muted ? '꺼짐' : '켜짐'}`;
    });

    document.getElementById('btn-painting')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openPaintingMenu();
    });

    // Star Get Modal buttons
    document.getElementById('star-continue-btn')!.addEventListener('click', () => {
      this.closeStarModal(false);
    });
    document.getElementById('star-painting-btn')!.addEventListener('click', () => {
      this.closeStarModal(true);
    });
  }

  private renderMissionSelector(): void {
    const listEl = document.getElementById('mission-list')!;
    const hintEl = document.getElementById('mission-hint-box')!;
    listEl.innerHTML = '';

    for (const m of MISSIONS) {
      const earned = this.entities.collectedStars.has(m.id);
      const row = document.createElement('div');
      row.className = `mission-item ${m.id === this.selectedMissionId ? 'selected' : ''}`;
      row.innerHTML = `
        <span class="mission-star-badge ${earned ? 'earned' : ''}">${earned ? '★' : '☆'}</span>
        <div class="mission-text">
          <span class="mission-title">★${m.id} • ${m.title}</span>
          <span class="mission-sub">${m.subtitle}</span>
        </div>
      `;
      row.addEventListener('click', () => {
        this.selectedMissionId = m.id;
        this.sound.playCameraClick();
        this.renderMissionSelector();
      });
      listEl.appendChild(row);
    }

    const active = MISSIONS.find((m) => m.id === this.selectedMissionId) ?? MISSIONS[0];
    hintEl.textContent = `"${active.hint}"`;
  }

  private renderTrackerList(): void {
    const listEl = document.getElementById('tracker-list')!;
    listEl.innerHTML = '';
    for (const m of MISSIONS) {
      const done = this.entities.collectedStars.has(m.id);
      const div = document.createElement('div');
      div.className = `tracker-row ${done ? 'done' : ''}`;
      div.innerHTML = `
        <span class="mission-star-badge ${done ? 'earned' : ''}">${done ? '★' : '☆'}</span>
        <div class="mission-text">
          <span class="mission-title">${m.title}</span>
          <span class="mission-sub">${m.hint}</span>
        </div>
      `;
      listEl.appendChild(div);
    }
  }

  private toggleTrackerPanel(): void {
    const trackerPanel = document.getElementById('tracker-panel')!;
    const movesPanel = document.getElementById('moveset-panel')!;
    movesPanel.classList.add('hidden');
    const nowHidden = trackerPanel.classList.toggle('hidden');
    this.renderTrackerList();
    this.entities.setRadarVisible(!nowHidden);
  }

  public enterStageFromPainting(withFlyover = true): void {
    if (!this.inPaintingMenu) return;
    this.inPaintingMenu = false;

    if (!this.sound.isMuted()) {
      this.sound.init();
      this.sound.playPaintingEnter();
      this.sound.startMusic();
    }
    this.sound.setPhase(this.phase, false);

    // Spawn concentric burst ripples on painting
    for (let i = 0; i < 4; i++) {
      this.ripples.push({ x: 190, y: 135, r: 8 + i * 18, alpha: 1.0 });
    }

    const overlay = document.getElementById('painting-overlay')!;
    overlay.classList.add('warping');
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.classList.remove('warping');
    }, 420);

    document.getElementById('hud')!.classList.remove('hidden');

    const mission = MISSIONS.find((m) => m.id === this.selectedMissionId) ?? MISSIONS[0];
    if (withFlyover) {
      this.cameraRig.startMissionFlyover(mission.cameraPos, mission.focusPos, 2.2);
    }
    this.showMoveBanner(`★ 도전 ${mission.id}: ${mission.title} ★`, '#fde047');
  }

  public openPaintingMenu(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.inPaintingMenu = true;
    this.renderMissionSelector();
    document.getElementById('painting-overlay')!.classList.remove('hidden');
    document.getElementById('hud')!.classList.add('hidden');
  }

  private handleStarCollected(id: StarId): void {
    this.starModalOpen = true;
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.cameraRig.startStarCelebration(this.player.facingYaw);

    const mission = MISSIONS.find((m) => m.id === id)!;
    const total = this.entities.collectedStars.size;
    document.getElementById('star-modal-title')!.textContent = mission.title;
    document.getElementById('star-modal-tally')!.textContent =
      total >= 5
        ? '👑 파워스타 5개 완성! 성역의 달인! 👑'
        : `모은 파워스타: ${total} / 5`;

    document.getElementById('star-modal')!.classList.remove('hidden');
    this.renderTrackerList();
  }

  private closeStarModal(goToPainting: boolean): void {
    this.starModalOpen = false;
    document.getElementById('star-modal')!.classList.add('hidden');
    this.player.exitStarDance();
    this.cameraRig.stopStarCelebration();
    if (goToPainting) {
      this.openPaintingMenu();
    }
  }

  private renderPowerPie(hp: number): void {
    if (hp === this.lastHealthRendered) return;
    this.lastHealthRendered = hp;

    const svg = document.getElementById('power-pie-svg')!;
    const cx = 50;
    const cy = 50;
    const r = 42;
    const color = hp >= 6 ? '#38bdf8' : hp >= 3 ? '#facc15' : '#ef4444';

    let html = `<circle cx="50" cy="50" r="46" fill="#0f172a" stroke="#fde047" stroke-width="3"/>`;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 - Math.PI / 2 + 0.04;
      const a1 = ((i + 1) / 8) * Math.PI * 2 - Math.PI / 2 - 0.04;
      const x0 = cx + Math.cos(a0) * r;
      const y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r;
      const y1 = cy + Math.sin(a1) * r;
      const filled = i < hp;
      html += `<path d="M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${filled ? color : '#1e293b'}" />`;
    }
    html += `<circle cx="50" cy="50" r="16" fill="#e11d48" stroke="#fef08a" stroke-width="2.5"/>`;
    html += `<text x="50" y="55" text-anchor="middle" fill="#ffffff" font-family="Bungee, sans-serif" font-size="14">${hp}</text>`;
    svg.innerHTML = html;
  }

  private updatePhaseHUD(): void {
    const btn = document.getElementById('phase-hud-btn')!;
    const icon = document.getElementById('phase-icon')!;
    const title = document.getElementById('phase-title')!;
    const sub = document.getElementById('phase-sub')!;

    btn.className = `phase-medallion ${this.phase}`;
    if (this.phase === 'sol') {
      icon.textContent = '☀';
      title.textContent = '낮의 세계';
      sub.textContent = '움직이는 태엽 • [F] / 우클릭';
    } else {
      icon.textContent = '☾';
      title.textContent = '밤의 세계';
      sub.textContent = '얼어붙은 폭포 • [F] / 우클릭';
    }
  }

  private showMoveBanner(text: string, color = '#fde047'): void {
    const el = document.getElementById('move-banner')!;
    el.textContent = text;
    el.style.color = color;
    el.classList.add('show');
    if (this.moveBannerTimeout !== null) {
      clearTimeout(this.moveBannerTimeout);
    }
    this.moveBannerTimeout = window.setTimeout(() => {
      el.classList.remove('show');
    }, 1850);
  }

  private updateSignDialog(sign: Signpost | null): void {
    const box = document.getElementById('sign-dialog')!;
    if (!sign) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    document.getElementById('sign-title')!.textContent = `🪧 ${sign.title}`;
    document.getElementById('sign-body')!.textContent = sign.body;
  }

  private updateHUD(): void {
    this.renderPowerPie(this.player.health);
    document.getElementById('hud-stars')!.textContent = `${this.entities.collectedStars.size} / 5`;
    document.getElementById('hud-coins')!.textContent = String(this.entities.coinCount).padStart(2, '0');
    document.getElementById('hud-red-coins')!.textContent = `${this.entities.redCoinCount} / 8`;

    // Chrono-Ring Sprint Banner
    const sprintBar = document.getElementById('sprint-bar')!;
    if (this.entities.ringSprintActive) {
      sprintBar.classList.remove('hidden');
      document.getElementById('sprint-timer')!.textContent = `${Math.max(0, this.entities.ringSprintTimer).toFixed(1)}s`;
      document.getElementById('sprint-rings')!.textContent = `고리: ${this.entities.ringsCleared} / ${this.entities.totalRings}`;
    } else {
      sprintBar.classList.add('hidden');
    }

    // Summit Boss Bar
    const bossBar = document.getElementById('boss-bar')!;
    const distBoss = Math.hypot(this.player.pos.x - this.entities.bossPos.x, this.player.pos.z - this.entities.bossPos.z);
    if (!this.entities.bossDefeated && distBoss < 21 && this.player.pos.y > 34) {
      bossBar.classList.remove('hidden');
      const pipsEl = document.getElementById('boss-pips')!;
      let pHtml = '';
      for (let i = 0; i < this.entities.bossMaxHp; i++) {
        pHtml += `<span class="boss-pip ${i < this.entities.bossHp ? 'filled' : ''}"></span>`;
      }
      pipsEl.innerHTML = pHtml;
    } else {
      bossBar.classList.add('hidden');
    }
  }

  // ==================== INPUT HANDLING ====================

  private setupInputs(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);

      if (this.inPaintingMenu) {
        if (code === 'Space' || code === 'Enter') {
          e.preventDefault();
          this.enterStageFromPainting(true);
        } else if (code === 'ArrowDown' || code === 'KeyS') {
          this.selectedMissionId = ((this.selectedMissionId % 5) + 1) as StarId;
          this.renderMissionSelector();
        } else if (code === 'ArrowUp' || code === 'KeyW') {
          this.selectedMissionId = (((this.selectedMissionId + 3) % 5) + 1) as StarId;
          this.renderMissionSelector();
        }
        return;
      }

      if (this.starModalOpen) {
        if (code === 'Space' || code === 'Enter') {
          e.preventDefault();
          this.closeStarModal(false);
        }
        return;
      }

      if (code === 'Space') {
        e.preventDefault();
        this.oneShot.jump = true;
      } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyZ') {
        this.oneShot.crouch = true;
      } else if (code === 'KeyE' || code === 'KeyX') {
        this.oneShot.dive = true;
      } else if (code === 'KeyF') {
        this.togglePhase();
      } else if (code === 'KeyR') {
        this.oneShot.echo = true;
      } else if (code === 'KeyQ') {
        this.cameraRig.snapLakitu(-1);
        this.sound.playCameraClick();
      } else if (code === 'KeyC') {
        this.cameraRig.snapLakitu(1);
        this.sound.playCameraClick();
      } else if (code === 'KeyV') {
        this.cameraRig.centerBehind(this.player.facingYaw);
        this.sound.playCameraClick();
      } else if (code === 'KeyG') {
        this.cameraRig.zoomStep();
        this.sound.playCameraClick();
      } else if (code === 'KeyH') {
        document.getElementById('moveset-panel')!.classList.toggle('hidden');
      } else if (code === 'Tab') {
        e.preventDefault();
        this.toggleTrackerPanel();
      } else if (code === 'KeyM') {
        const muted = this.sound.toggleMute();
        document.getElementById('btn-audio')!.innerHTML = `<kbd>M</kbd> 소리: ${muted ? '꺼짐' : '켜짐'}`;
      } else if (code === 'KeyP') {
        this.openPaintingMenu();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Canvas mouse camera (Pointer Lock + fallback drag!) + LMB Dive + RMB Phase Shift!
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
      if (this.inPaintingMenu || this.starModalOpen) return;
      this.sound.init();

      if (e.button === 2) {
        this.togglePhase();
        return;
      }

      if (e.button === 0) {
        if (document.pointerLockElement === canvas) {
          this.oneShot.dive = true;
        } else {
          this.isDraggingCamera = true;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          canvas.requestPointerLock?.();
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDraggingCamera = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.inPaintingMenu || this.starModalOpen) return;
      if (document.pointerLockElement === canvas) {
        this.cameraRig.onMouseMove(e.movementX, e.movementY);
      } else if (this.isDraggingCamera) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.cameraRig.onMouseMove(dx * 1.4, dy * 1.4);
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const hint = document.getElementById('pointer-hint')!;
      if (document.pointerLockElement === canvas) {
        hint.innerHTML = `마우스 시점 고정 (<kbd>Esc</kbd> 해제) • <kbd>LMB</kbd> Dive • <kbd>RMB</kbd> Phase Shift`;
      } else {
        hint.innerHTML = `화면을 클릭하면 마우스로 시점 조작 • <kbd>Q</kbd>/<kbd>C</kbd> 회전 • <kbd>V</kbd> 시점 정렬`;
      }
    });
  }

  private buildInputState(consumeOneShots: boolean): InputState {
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? -1 : 0;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const forward = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const back = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? -1 : 0;

    const input: InputState = {
      moveX: left + right,
      moveZ: forward + back,
      jumpHeld: this.keys.has('Space'),
      crouchHeld:
        this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyZ'),
      jumpPressed: consumeOneShots ? this.oneShot.jump : false,
      crouchPressed: consumeOneShots ? this.oneShot.crouch : false,
      divePressed: consumeOneShots ? this.oneShot.dive : false,
      echoPressed: consumeOneShots ? this.oneShot.echo : false,
    };

    if (consumeOneShots) {
      this.oneShot.jump = false;
      this.oneShot.crouch = false;
      this.oneShot.dive = false;
      this.oneShot.echo = false;
    }

    return input;
  }

  // ==================== ANIMATED SM64 PAINTING RENDERER ====================

  private renderPaintingCanvas(nowSec: number): void {
    if (!this.inPaintingMenu) return;
    const ctx = this.paintingCtx;
    const w = this.paintingCanvas.width;
    const h = this.paintingCanvas.height;

    // 1. Sol Golden Sky (Left)
    const solGrad = ctx.createLinearGradient(0, 0, 0, h);
    solGrad.addColorStop(0, '#1d8cf8');
    solGrad.addColorStop(0.58, '#93e1ff');
    solGrad.addColorStop(1, '#14b8a6');
    ctx.fillStyle = solGrad;
    ctx.fillRect(0, 0, w, h);

    // Painted Sol Clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    for (const [cx, cy, r] of [
      [48, 108, 16],
      [68, 104, 20],
      [88, 110, 14],
    ]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Luna Astral Sky (Right, clipped diagonally with gentle wave)
    const splitTop = w * 0.53 + Math.sin(nowSec * 1.2) * 8;
    const splitBot = w * 0.43 + Math.cos(nowSec * 1.2) * 8;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(splitTop, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(splitBot, h);
    ctx.closePath();
    ctx.clip();

    const lunaGrad = ctx.createLinearGradient(0, 0, 0, h);
    lunaGrad.addColorStop(0, '#090f26');
    lunaGrad.addColorStop(0.58, '#1d357a');
    lunaGrad.addColorStop(1, '#0d4f6b');
    ctx.fillStyle = lunaGrad;
    ctx.fillRect(0, 0, w, h);

    // Sparkling Constellations in Luna Sky
    for (let i = 0; i < 36; i++) {
      const sx = w * 0.44 + ((i * 59) % (w * 0.54));
      const sy = 12 + ((i * 37) % (h * 0.56));
      const tw = 1.5 + Math.sin(nowSec * 3 + i) * 0.9;
      ctx.fillStyle = i % 4 === 0 ? '#67e8f9' : '#f8fafc';
      ctx.fillRect(sx, sy, tw, tw);
    }

    // Floating Astral Skyway Platforms on Right
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(286, 136, 36, 7);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(318, 114, 34, 7);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(296, 92, 32, 7);
    ctx.restore();

    // Glowing Diagonal Rift Seam
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(splitTop, 0);
    ctx.lineTo(splitBot, h);
    ctx.stroke();

    // Radiant Sol Sun (Left) & Astral Crescent Moon (Right)
    ctx.fillStyle = 'rgba(253, 224, 71, 0.26)';
    ctx.beginPath();
    ctx.arc(68, 52, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(68, 52, 21, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#67e8f9';
    ctx.beginPath();
    ctx.arc(w - 64, 52, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111f4d';
    ctx.beginPath();
    ctx.arc(w - 55, 46, 17, 0, Math.PI * 2);
    ctx.fill();

    // Rotating Giant Golden Clockwork Gear Halo behind Summit
    ctx.save();
    ctx.translate(190, 88);
    ctx.rotate(nowSec * 0.55);
    ctx.fillStyle = '#f59e0b';
    for (let t = 0; t < 12; t++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.fillRect(-5, -39, 10, 10);
    }
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Faceted N64 Clockwork Mountain (Lit Left Face + Shaded Right Face)
    ctx.fillStyle = '#9c856e';
    ctx.beginPath();
    ctx.moveTo(64, h - 34);
    ctx.lineTo(154, 86);
    ctx.lineTo(192, 86);
    ctx.lineTo(192, h - 34);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#57534e';
    ctx.beginPath();
    ctx.moveTo(192, 86);
    ctx.lineTo(228, 86);
    ctx.lineTo(316, h - 34);
    ctx.lineTo(192, h - 34);
    ctx.closePath();
    ctx.fill();

    // Summit Crown Arena & Pillars
    ctx.fillStyle = '#e7dcc8';
    ctx.fillRect(148, 80, 86, 9);
    ctx.fillStyle = '#d97706';
    for (const px of [152, 176, 202, 224]) {
      ctx.fillRect(px, 68, 6, 13);
    }

    // Twin Waterfalls on West Cliff + Frothy Mist Pool
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(98, 128, 15, 98);
    ctx.fillRect(122, 128, 15, 98);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    for (let i = 0; i < 5; i++) {
      const fy = 132 + ((Math.floor(nowSec * 60) + i * 20) % 88);
      ctx.fillRect(102, fy, 6, 10);
      ctx.fillRect(126, fy, 6, 10);
    }
    ctx.beginPath();
    ctx.ellipse(118, 226, 24, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belltower Archway on East Slope
    ctx.fillStyle = '#d6ccc2';
    ctx.fillRect(244, 150, 36, 8);
    ctx.fillRect(248, 132, 7, 18);
    ctx.fillRect(269, 132, 7, 18);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(245, 127, 34, 6);

    // Lush Checkered Foreground Island & Golden Sundial Plaza
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 14, 184, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e7dcc8';
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 16, 78, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Floating Summit Power Star
    ctx.fillStyle = '#fde047';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', 191, 56 + Math.sin(nowSec * 3.2) * 4);

    // Subtle Canvas Vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, 95, w / 2, h / 2, 230);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(10, 15, 30, 0.34)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Liquid SM64 그림으로 Ripples!
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += 2.2;
      rp.alpha -= 0.022;
      if (rp.alpha <= 0) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${rp.alpha.toFixed(2)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ==================== MAIN GAME LOOP ====================

  private loop(nowMs: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = Math.min(0.05, Math.max(0.001, (nowMs - this.lastFrameTime) * 0.001));
    this.lastFrameTime = nowMs;

    this.renderPaintingCanvas(nowMs * 0.001);

    // Update radial Sol/Luna shader wave & sky atmosphere
    const lunaMix = this.phaseVisuals.update(rawDt);
    this.currentSky.lerpColors(this.solSky, this.lunaSky, lunaMix);
    (this.scene.fog as THREE.FogExp2).color.copy(this.currentSky);

    this.dirLight.color.lerpColors(new THREE.Color(0xfff4d6), new THREE.Color(0x93c5fd), lunaMix);
    this.dirLight.intensity = THREE.MathUtils.lerp(1.85, 1.15, lunaMix);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.85, 0.55, lunaMix);

    if (this.inPaintingMenu) {
      // Gentle scenic orbit around Sundial Sanctuary behind the 그림으로 Menu!
      const t = nowMs * 0.00022;
      this.camera.position.set(Math.sin(t) * 68, 34, Math.cos(t) * 68 - 6);
      this.camera.lookAt(0, 16, -16);
      this.stage.update(rawDt, this.phase, lunaMix);
      this.particles.update(rawDt, this.phase);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Fixed-timestep 120Hz SM64 Physics & Dynamic Platform Stepping
    this.physAccum += rawDt;
    const camFwd = this.cameraRig.getForwardXZ(new THREE.Vector3());
    const camRight = this.cameraRig.getRightXZ(new THREE.Vector3());

    let firstSubstep = true;
    while (this.physAccum >= this.fixedDt) {
      this.collision.syncDynamicBodiesBeginStep();
      this.stage.update(this.fixedDt, this.phase, lunaMix);
      this.collision.syncDynamicBodiesEndStep();

      const input = this.buildInputState(firstSubstep);
      firstSubstep = false;

      this.player.update(this.fixedDt, input, camFwd, camRight, this.phase);
      this.entities.update(this.fixedDt, this.player, this.phase);

      this.physAccum -= this.fixedDt;
    }

    const speedRatio = this.player.getHorizontalSpeed() / 12.6;
    this.cameraRig.update(
      rawDt,
      this.player.pos,
      this.player.grounded,
      speedRatio,
      this.collision,
      this.phase
    );

    this.particles.update(rawDt, this.phase);
    this.updateHUD();
    this.renderer.render(this.scene, this.camera);
  }

  // Expose clean diagnostic/playtest API on window
  public getDebugSnapshot() {
    return {
      inPaintingMenu: this.inPaintingMenu,
      phase: this.phase,
      playerPos: {
        x: Number(this.player.pos.x.toFixed(2)),
        y: Number(this.player.pos.y.toFixed(2)),
        z: Number(this.player.pos.z.toFixed(2)),
      },
      playerState: this.player.state,
      grounded: this.player.grounded,
      health: this.player.health,
      coins: this.entities.coinCount,
      redCoins: this.entities.redCoinCount,
      stars: Array.from(this.entities.collectedStars),
      bossHp: this.entities.bossHp,
    };
  }

  public teleportPlayer(x: number, y: number, z: number): void {
    this.player.pos.set(x, y, z);
    this.player.vel.set(0, 0, 0);
    this.cameraRig.resetBehindPlayer(this.player.pos, this.player.facingYaw);
  }
}

const game = new Sundial64Game();
(window as unknown as { __SUNDIAL64__: Sundial64Game }).__SUNDIAL64__ = game;
