const SCREEN_W = 640;
const SCREEN_H = 960;
const SCREEN_CENTER_X = SCREEN_W / 2;   // スクリーン幅の半分
const SCREEN_CENTER_Y = SCREEN_H / 2;  // スクリーン高さの半分
const MAX_STAGE = 100;

// ゲーム状態
const GAME_STATE = {
    WAIT: 'WAIT',
    PULLING: 'PULLING',
    MOVING: 'MOVING',
    ENEMY_TURN: 'ENEMY_TURN',
    ENEMY_MOVING: 'ENEMY_MOVING',
    FADE_IN: 'FADE_IN',
    FADE_OUT: 'FADE_OUT',
    MENU: 'MENU',
    GAME_OVER: 'GAME_OVER'
};

// デバッグ: true で敵の当たり判定矩形（hitTestElement 相当）を表示
const DEBUG_SHOW_HITBOX = false;

// ==========================================
// ステージ外周・可動領域の制限定数
// ==========================================
const TILE_SIZE = 64;
const LIMIT_LEFT = TILE_SIZE;                  // 64
const LIMIT_RIGHT = SCREEN_W - TILE_SIZE;      // 576
const LIMIT_TOP = TILE_SIZE;                   // 64
const LIMIT_BOTTOM = SCREEN_H - (TILE_SIZE * 2); // 832

// プレイヤー移動・バースト演出のチューニング
const PLAYER_STOP_THRESHOLD = 0.5;
const BURST_BOOST_SPEED_MULTIPLIER = 2;
const BURST_GHOST_LIFETIME = 1000;
const BURST_GHOST_SPAWN_INTERVAL = 35;
const BURST_GHOST_OFFSET = 0;

// 敵との接触ダメージが再発生するまでのフレーム数 (60FPS想定で約0.75秒)
const CONTACT_DAMAGE_INTERVAL = 45;

// プレイヤー名スロット（タイトル画面）
const NAME_CHARS = ['ネ', 'ム', 'レ', 'ス', 'う', 'て', 'な', '★'];
const NAME_LENGTH = 4;
const NAME_SLOT_SPIN_INTERVAL = 3; // 未決定枠の文字切替間隔（フレーム）

// ボーナス付きのプレイヤー名（パターン5専用）
const BONUS_NAMES = ['ネムレス', '★うてな', 'う★てな', 'うて★な', 'うてな★', '★★★★'];

// プレイヤー名に応じたステータス初期値・スキル加算値の5パターン
// パターン1〜4: 通常（名前ハッシュで決定）、パターン5: 特別名のみで最有利
// 差は致命的にならない程度に抑える
const STAT_PATTERNS = [
    // 1: HP寄り（やや低速）
    {
        init: { hp: 110, maxHp: 110, atk: 9, def: 5, spd: 28 },
        skill: { maxHp: 24, atk: 4, def: 3, spd: 1 }
    },
    // 2: ATK寄り（やや低HP・低DEF）
    {
        init: { hp: 90, maxHp: 90, atk: 12, def: 4, spd: 30 },
        skill: { maxHp: 16, atk: 6, def: 2, spd: 2 }
    },
    // 3: バランス（従来相当）
    {
        init: { hp: 100, maxHp: 100, atk: 10, def: 5, spd: 30 },
        skill: { maxHp: 20, atk: 5, def: 3, spd: 2 }
    },
    // 4: SPD寄り（やや低HP）
    {
        init: { hp: 95, maxHp: 95, atk: 10, def: 4, spd: 35 },
        skill: { maxHp: 18, atk: 5, def: 2, spd: 3 }
    },
    // 5: 最有利（特別名専用）
    {
        init: { hp: 120, maxHp: 120, atk: 12, def: 6, spd: 32 },
        skill: { maxHp: 25, atk: 6, def: 4, spd: 3 }
    }
];

// プレイヤー名からパターン番号(1〜5)を決定
const getNamePattern = function (name) {
    if (BONUS_NAMES.includes(name)) return 5;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash |= 0;
    }
    return (Math.abs(hash) % 4) + 1;
};

// パターン番号からステータス定義を取得
const getStatPattern = function (pattern) {
    return STAT_PATTERNS[Math.max(0, Math.min(4, pattern - 1))];
};

// セーブデータ関連
const SAVE_KEY = 'slingshot_action_rpg_save';
