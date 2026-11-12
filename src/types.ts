import * as THREE from 'three';

export type WorldPhase = 'sol' | 'luna';
export type PhaseRule = 'both' | 'sol' | 'luna';

export type SurfaceType =
  | 'grass'
  | 'stone'
  | 'wood'
  | 'brass'
  | 'ice'
  | 'astral'
  | 'sand'
  | 'lava';

export type MoveState =
  | 'idle'
  | 'run'
  | 'skid'
  | 'crouch'
  | 'jump1'
  | 'jump2'
  | 'jump3'
  | 'sideflip'
  | 'backflip'
  | 'longjump'
  | 'dive'
  | 'diveslide'
  | 'rollout'
  | 'groundpound_start'
  | 'groundpound_fall'
  | 'groundpound_land'
  | 'wallslide'
  | 'wallkick'
  | 'hurt'
  | 'star_dance';

export type StarId = 1 | 2 | 3 | 4 | 5;

export interface MissionDef {
  id: StarId;
  title: string;
  subtitle: string;
  hint: string;
  focusPos: THREE.Vector3;
  cameraPos: THREE.Vector3;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 1,
    title: '시계왕 호롤로지의 왕관',
    subtitle: '정상에서 펼쳐지는 보스전',
    hint: '태엽길을 따라 정상으로 올라가세요. 내려찍기를 피한 뒤 [F]로 밤으로 전환해 톱니를 얼리고, 빛나는 핵을 [Shift] 엉덩이 찍기로 공격하세요!',
    focusPos: new THREE.Vector3(0, 41, -30),
    cameraPos: new THREE.Vector3(18, 49, -8),
  },
  {
    id: 2,
    title: '얼어붙은 폭포를 올라라',
    subtitle: '쌍둥이 폭포 협곡',
    hint: '[F]로 밤으로 전환하면 폭포가 얼음벽으로 변합니다. 벽에 닿을 때 [Space]를 눌러 벽차기를 이어가며 절벽 위 신전까지 올라가세요!',
    focusPos: new THREE.Vector3(-44, 24, -8),
    cameraPos: new THREE.Vector3(-22, 22, 16),
  },
  {
    id: 3,
    title: '황혼의 빨간 동전 여덟 개',
    subtitle: '낮과 밤을 넘나드는 보물찾기',
    hint: '폭포 뒤, 잠든 태엽버섯 위, 밤에 나타나는 발판에서 빨간 동전 8개를 찾으세요. [Tab]을 누르면 동전 위치에 빛기둥이 표시됩니다!',
    focusPos: new THREE.Vector3(0, 5, 32),
    cameraPos: new THREE.Vector3(14, 14, 52),
  },
  {
    id: 4,
    title: '낮과 밤을 잇는 하늘길',
    subtitle: '종탑에서 시작하는 공중 도전',
    hint: '동쪽 종탑에서 하늘길에 도전하세요. 달리면서 [Shift+Space]로 멀리뛰기, 공중에서 [F]로 전환해 다음 발판을 만들어보세요!',
    focusPos: new THREE.Vector3(46, 36, -18),
    cameraPos: new THREE.Vector3(26, 34, 6),
  },
  {
    id: 5,
    title: '해시계 시간고리 달리기',
    subtitle: '제한시간 파쿠르 도전',
    hint: '광장의 파란 스위치를 [Space → Shift] 엉덩이 찍기로 누르고, 제한시간 안에 황금 시간고리 7개를 모두 통과하세요!',
    focusPos: new THREE.Vector3(-12, 4, 34),
    cameraPos: new THREE.Vector3(-2, 12, 50),
  },
];
