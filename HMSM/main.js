phina.globalize();

const VERSION_STR = '1.6';

// セーブデータ関連
const hasSaveData = function () {
    try {
        return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
        return false;
    }
};

const saveGame = function (data) {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
        // ストレージ不可時は無視
    }
};

const loadGame = function () {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
};

const deleteSave = function () {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch (e) {
        // 無視
    }
};

// ==========================================
// ダメージ計算・境界処理の共通ヘルパー
// ==========================================

// 攻撃力と防御力からダメージ値を算出する (最低1ダメージ保証)
const calcDamage = function (atk, def) {
    return Math.max(1, Math.floor(atk - (def || 0)));
};

// スキルLvによるダメージ倍率（Lv1〜5は1.0、Lv6以降は超過分で上昇）
// Lv6: 1.15 / Lv7: 1.30 / Lv8: 1.45 ...
const getSkillDmgMult = function (level) {
    if (!level || level <= 5) return 1.0;
    return 1.0 + (level - 5) * 0.15;
};

// stats.hp を持つ対象にHPを下回らせずにダメージを与える
const applyDamage = function (target, damage) {
    target.stats.hp = Math.max(0, target.stats.hp - damage);
};

// SEを再生する（未ロード時は無視）
const playSe = function (key) {
    try {
        SoundManager.play(key);
    } catch (e) {
        // アセット未準備時などはサイレントにスキップ
    }
};

// 可動領域の壁で反射させる。壁に当たった場合はtrueを返す
const reflectInBounds = function (obj, velocity) {
    let hitWall = false;
    if (obj.left < LIMIT_LEFT) { obj.left = LIMIT_LEFT; velocity.x *= -1; hitWall = true; }
    else if (obj.right > LIMIT_RIGHT) { obj.right = LIMIT_RIGHT; velocity.x *= -1; hitWall = true; }
    if (obj.top < LIMIT_TOP) { obj.top = LIMIT_TOP; velocity.y *= -1; hitWall = true; }
    else if (obj.bottom > LIMIT_BOTTOM) { obj.bottom = LIMIT_BOTTOM; velocity.y *= -1; hitWall = true; }
    return hitWall;
};

// 可動領域の外側に出たかどうかを判定する
const isOutOfBounds = function (obj) {
    return obj.x < LIMIT_LEFT || obj.x > LIMIT_RIGHT || obj.y < LIMIT_TOP || obj.y > LIMIT_BOTTOM;
};

// Fisher–Yates で配列をその場でシャッフルして返す
const shuffleArray = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
};

// hitboxScale を考慮したAABB半サイズ（未設定時は1.0＝見た目どおり）
const getHitHalfSize = function (obj) {
    let scale = (obj.hitboxScale != null) ? obj.hitboxScale : 1;
    return {
        hw: obj.width * scale * 0.5,
        hh: obj.height * scale * 0.5
    };
};

// hitboxScale 対応の矩形当たり判定（hitTestElement 相当）
const hitTestWithHitbox = function (a, b) {
    let sa = getHitHalfSize(a);
    let sb = getHitHalfSize(b);
    return Math.abs(a.x - b.x) < sa.hw + sb.hw && Math.abs(a.y - b.y) < sa.hh + sb.hh;
};

// ==========================================
// 配置管理（実距離ベース方式）
// 可動領域を64pxセルで管理し、実距離で衝突判定する
// ==========================================
const PLACEMENT_COLS = 8;  // x方向セル数（中心x: 96〜544）
const PLACEMENT_ROWS = 12; // y方向セル数（中心y: 96〜800）

// ボス配置アンカー（優先度順・可動領域に対する割合指定）
const BOSS_ANCHORS = [
    { fx: 0.50, fy: 0.10 }, // 上段中央
    { fx: 0.22, fy: 0.10 }, // 上段左
    { fx: 0.78, fy: 0.10 }, // 上段右
    { fx: 0.50, fy: 0.32 }, // 中段中央
    { fx: 0.18, fy: 0.34 }, // 中段左
    { fx: 0.82, fy: 0.34 }, // 中段右
    { fx: 0.35, fy: 0.48 }, // 下段左
    { fx: 0.65, fy: 0.48 }, // 下段右
];

const createPlacementGrid = function () {
    // 配置済みオブジェクトのリスト {x, y, radius, margin}
    let placed = [];

    return {
        // 置けるか判定（可動領域からのはみ出し・配置済みとの実距離で判定）
        canPlace: function (x, y, radius, margin) {
            if (x - radius < LIMIT_LEFT || x + radius > LIMIT_RIGHT) return false;
            if (y - radius < LIMIT_TOP || y + radius > LIMIT_BOTTOM) return false;
            for (let i = 0; i < placed.length; i++) {
                let p = placed[i];
                // 自分と相手のマージンの大きい方を採用（安全側）
                let m = Math.max(margin, p.margin);
                if (Math.hypot(x - p.x, y - p.y) < radius + p.radius + m) return false;
            }
            return true;
        },
        // 配置登録
        reserve: function (x, y, radius, margin) {
            placed.push({ x: x, y: y, radius: radius, margin: margin });
        },
        // 指定行帯のセルをシャッフルして返す（配置候補の列挙用）
        shuffledCells: function (rowMin, rowMax) {
            let list = [];
            for (let c = 0; c < PLACEMENT_COLS; c++) {
                for (let r = rowMin; r <= rowMax; r++) {
                    list.push({ col: c, row: r });
                }
            }
            return shuffleArray(list);
        }
    };
};

phina.define("Explosion", {
    // Spriteを継承
    superClass: 'Sprite',
    // 初期化
    init: function (xpos, ypos, size) {
        // 親クラスの初期化
        this.superInit('explosion', 48, 48);
        // SpriteSheetをスプライトにアタッチ
        var anim = FrameAnimation('explosion_ss').attachTo(this);
        // スプライトシートのサイズにフィットさせない
        anim.fit = false;
        //アニメーションを再生する
        anim.gotoAndPlay('start');
        // サイズ変更
        this.setSize(size, size);

        this.x = xpos;
        this.y = ypos;

        // 参照用
        this.anim = anim;
    },
    // 毎フレーム処理
    update: function () {
        if (this.isGameOver) return;
        // アニメーションが終わったら自身を消去
        if (this.anim.finished) {
            this.remove();
        }
    },
});

// ==========================================
// ステージ・敵・ボスデータの定義
// ==========================================
// 障害物数の調整方針:
// 序盤 … 少なめで動きやすく、爆発はほぼ出さない
// 中盤 … 通常・爆発を段階的に増やして反射ルートを意識させる
// 終盤 … 爆発多めで危険、通常も適度に（詰まりすぎない上限）
const STAGE_DEFINITIONS = [
    {
        start: 1, end: 5,
        minEnemies: 2, maxEnemies: 3,
        minNormalObs: 1, maxNormalObs: 2,
        minExplosiveObs: 1, maxExplosiveObs: 1,
        enemies: ['スライム０', 'ゴブリン０', 'アーチャー０', 'ウィザード０', 'ゴーレム０']
    },
    {
        start: 6, end: 9,
        minEnemies: 2, maxEnemies: 3,
        minNormalObs: 1, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 1,
        enemies: ['ゴブリン０', 'アーチャー０', 'ウィザード０', 'ゴーレム０', 'スライム１']
    },
    {
        start: 10, end: 10,
        minEnemies: 2, maxEnemies: 2,
        minNormalObs: 1, maxNormalObs: 2,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['ゴブリン０', 'アーチャー０', 'ゴーレム０']
    },
    {
        start: 11, end: 15,
        minEnemies: 2, maxEnemies: 3,
        minNormalObs: 2, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['アーチャー０', 'ウィザード０', 'ゴーレム０', 'スライム１', 'ゴブリン１']
    },
    {
        start: 16, end: 19,
        minEnemies: 2, maxEnemies: 3,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['ウィザード０', 'ゴーレム０', 'スライム１', 'ゴブリン１', 'アーチャー１']
    },
    {
        start: 20, end: 20,
        minEnemies: 2, maxEnemies: 2,
        minNormalObs: 1, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['ゴーレム０', 'ゴブリン１', 'アーチャー１']
    },
    {
        start: 21, end: 25,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['ゴーレム０', 'スライム１', 'ゴブリン１', 'アーチャー１', 'ウィザード１']
    },

    {
        start: 26, end: 29,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['スライム１', 'ゴブリン１', 'アーチャー１', 'ウィザード１', 'ゴーレム１']
    },
    {
        start: 30, end: 30,
        minEnemies: 3, maxEnemies: 3,
        minNormalObs: 1, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 2,
        enemies: ['ゴブリン１', 'アーチャー１', 'ゴーレム１']
    },
    {
        start: 31, end: 35,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 2, maxNormalObs: 5,
        minExplosiveObs: 1, maxExplosiveObs: 3,
        enemies: ['ゴブリン１', 'アーチャー１', 'ウィザード１', 'ゴーレム１', 'スライム２']
    },
    {
        start: 36, end: 39,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 2, maxNormalObs: 5,
        minExplosiveObs: 1, maxExplosiveObs: 3,
        enemies: ['アーチャー１', 'ウィザード１', 'ゴーレム１', 'スライム２', 'ゴブリン２']
    },
    {
        start: 40, end: 40,
        minEnemies: 3, maxEnemies: 3,
        minNormalObs: 2, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 3,
        enemies: ['アーチャー１', 'ゴーレム１', 'ゴブリン２']
    },
    {
        start: 41, end: 45,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 3, maxNormalObs: 5,
        minExplosiveObs: 1, maxExplosiveObs: 3,
        enemies: ['ウィザード１', 'ゴーレム１', 'スライム２', 'ゴブリン２', 'アーチャー２']
    },
    {
        start: 46, end: 49,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 3, maxNormalObs: 5,
        minExplosiveObs: 2, maxExplosiveObs: 3,
        enemies: ['ゴーレム１', 'スライム２', 'ゴブリン２', 'アーチャー２', 'ウィザード２']
    },
    {
        start: 50, end: 50,
        minEnemies: 3, maxEnemies: 3,
        minNormalObs: 2, maxNormalObs: 3,
        minExplosiveObs: 1, maxExplosiveObs: 3,
        enemies: ['ゴーレム１', 'ゴブリン２', 'アーチャー２', 'ウィザード２']
    },

    {
        start: 51, end: 55,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 3, maxNormalObs: 5,
        minExplosiveObs: 2, maxExplosiveObs: 3,
        enemies: ['スライム２', 'ゴブリン２', 'アーチャー２', 'ウィザード２', 'ゴーレム２']
    },
    {
        start: 56, end: 59,
        minEnemies: 3, maxEnemies: 4,
        minNormalObs: 3, maxNormalObs: 5,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['ゴブリン２', 'アーチャー２', 'ウィザード２', 'ゴーレム２', 'スライム３']
    },
    {
        start: 60, end: 60,
        minEnemies: 2, maxEnemies: 2,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 2, maxExplosiveObs: 3,
        enemies: ['ゴブリン２', 'アーチャー２', 'ウィザード２', 'ゴーレム２']
    },
    {
        start: 61, end: 65,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 3, maxNormalObs: 6,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['アーチャー２', 'ウィザード２', 'ゴーレム２', 'スライム３', 'ゴブリン３']
    },
    {
        start: 66, end: 69,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 3, maxNormalObs: 6,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['ウィザード２', 'ゴーレム２', 'スライム３', 'ゴブリン３', 'アーチャー３']
    },
    {
        start: 70, end: 70,
        minEnemies: 1, maxEnemies: 2,
        minNormalObs: 2, maxNormalObs: 3,
        minExplosiveObs: 2, maxExplosiveObs: 3,
        enemies: ['ウィザード２', 'ゴーレム２', 'ゴブリン３', 'アーチャー３']
    },
    {
        start: 71, end: 75,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 3, maxNormalObs: 6,
        minExplosiveObs: 3, maxExplosiveObs: 4,
        enemies: ['ゴーレム２', 'スライム３', 'ゴブリン３', 'アーチャー３', 'ウィザード３']
    },

    {
        start: 76, end: 79,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 4, maxNormalObs: 6,
        minExplosiveObs: 3, maxExplosiveObs: 5,
        enemies: ['スライム３', 'ゴブリン３', 'アーチャー３', 'ウィザード３', 'ゴーレム３']
    },
    {
        start: 80, end: 80,
        minEnemies: 1, maxEnemies: 2,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['ゴブリン３', 'アーチャー３', 'ウィザード３', 'ゴーレム３']
    },
    {
        start: 81, end: 85,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 3, maxNormalObs: 6,
        minExplosiveObs: 3, maxExplosiveObs: 5,
        enemies: ['ゴブリン３', 'アーチャー３', 'ウィザード３', 'ゴーレム３', 'スライム４']
    },
    {
        start: 86, end: 89,
        minEnemies: 4, maxEnemies: 5,
        minNormalObs: 4, maxNormalObs: 6,
        minExplosiveObs: 3, maxExplosiveObs: 5,
        enemies: ['アーチャー３', 'ウィザード３', 'ゴーレム３', 'スライム４', 'ゴブリン４']
    },
    {
        start: 90, end: 90,
        minEnemies: 1, maxEnemies: 2,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['アーチャー３', 'ウィザード３', 'ゴーレム３', 'ゴブリン４']
    },
    {
        start: 91, end: 95,
        minEnemies: 4, maxEnemies: 6,
        minNormalObs: 4, maxNormalObs: 6,
        minExplosiveObs: 3, maxExplosiveObs: 5,
        enemies: ['ウィザード３', 'ゴーレム３', 'スライム４', 'ゴブリン４', 'アーチャー４']
    },
    {
        start: 96, end: 99,
        minEnemies: 4, maxEnemies: 6,
        minNormalObs: 4, maxNormalObs: 6,
        minExplosiveObs: 4, maxExplosiveObs: 5,
        enemies: ['ゴーレム３', 'スライム４', 'ゴブリン４', 'アーチャー４', 'ウィザード４']
    },

    {
        start: 100, end: 100,
        minEnemies: 2, maxEnemies: 3,
        minNormalObs: 2, maxNormalObs: 4,
        minExplosiveObs: 2, maxExplosiveObs: 4,
        enemies: ['ゴブリン４', 'アーチャー４', 'ウィザード４', 'ゴーレム４']
    },
];

// ==========================================
// 攻撃パターン・移動パターン定数
// ==========================================
const ATTACK_FULL_SCREEN = 0; // 画面全体ダメージ
const ATTACK_VERTICAL = 1; // 上下弾
const ATTACK_HORIZONTAL = 2; // 左右弾
const ATTACK_LASER_180 = 3; // 180°レーザー
const ATTACK_AREA = 4; // 範囲攻撃
const ATTACK_AIMED = 5; // 狙い撃ち弾
const ATTACK_4WAY = 6; // 十字4方向弾
const ATTACK_DIAGONAL_4WAY = 7; // 斜め4方向弾
const ATTACK_8WAY = 8; // 8方向弾
const ATTACK_SUMMON = 9; // 敵召喚
const ATTACK_LASER_90 = 10; // 180°レーザー

const MOVE_STATIONARY = 0; // 静止
const MOVE_VERTICAL = 1; // 上下移動
const MOVE_HORIZONTAL = 2; // 左右移動
const MOVE_DIAGONAL = 3; // 斜め移動
const MOVE_ZIGZAG = 4; // ジグザグ移動（右→一段下→左→一段下→右…を繰り返し、下端に達したら上方向で同じ動きを繰り返す）

// ランク0〜4で基本ステータスに差をつける
// 種別の役割:
//   スライム   … 低攻撃・低耐久・狙撃　・中頻度・静止
//   ゴブリン   … 中攻撃・中耐久・左右弾・高頻度・左右移動
//   アーチャー … 高攻撃・低耐久・上下弾・高頻度・上下移動
//   ウィザード … 高攻撃・中耐久・範囲　・低頻度・静止
//   ゴーレム   … 高攻撃・高耐久・十字弾・中頻度・斜め移動
// hitboxScale（任意）: 見た目に対する当たり判定の縮小率。未指定時は1.0
// baseScore（任意）: 撃破時の基本スコア。未指定時は通常敵100 / ボス150
const ENEMY_DEFINITIONS = [
    // ----- ランク0（序盤） -----
    { name: 'スライム０', image: 'enemy_ptn_0', hp: 20, atk: 8, def: 2, freq: 3, attackPattern: ATTACK_AIMED, movePattern: MOVE_STATIONARY, hitboxScale: 0.8, baseScore: 80 },
    { name: 'ゴブリン０', image: 'enemy_etc_0', hp: 35, atk: 12, def: 4, freq: 2, attackPattern: ATTACK_HORIZONTAL, movePattern: MOVE_HORIZONTAL, hitboxScale: 0.8, baseScore: 100 },
    { name: 'アーチャー０', image: 'enemy_ll_0', hp: 30, atk: 15, def: 3, freq: 2, attackPattern: ATTACK_VERTICAL, movePattern: MOVE_VERTICAL, hitboxScale: 0.8, baseScore: 110 },
    { name: 'ウィザード０', image: 'enemy_blk_0', hp: 40, atk: 20, def: 5, freq: 4, attackPattern: ATTACK_AREA, movePattern: MOVE_STATIONARY, hitboxScale: 1.0, baseScore: 120 },
    { name: 'ゴーレム０', image: 'enemy_spn_0', hp: 55, atk: 16, def: 9, freq: 3, attackPattern: ATTACK_4WAY, movePattern: MOVE_DIAGONAL, hitboxScale: 1.0, baseScore: 140 },

    // ----- ランク1 -----
    { name: 'スライム１', image: 'enemy_ptn_1', hp: 28, atk: 11, def: 3, freq: 3, attackPattern: ATTACK_AIMED, movePattern: MOVE_STATIONARY, hitboxScale: 0.9, baseScore: 90 },
    { name: 'ゴブリン１', image: 'enemy_etc_1', hp: 48, atk: 16, def: 5, freq: 2, attackPattern: ATTACK_HORIZONTAL, movePattern: MOVE_HORIZONTAL, hitboxScale: 0.9, baseScore: 110 },
    { name: 'アーチャー１', image: 'enemy_ll_1', hp: 40, atk: 20, def: 4, freq: 2, attackPattern: ATTACK_VERTICAL, movePattern: MOVE_VERTICAL, hitboxScale: 0.9, baseScore: 120 },
    { name: 'ウィザード１', image: 'enemy_blk_1', hp: 52, atk: 26, def: 6, freq: 3, attackPattern: ATTACK_AREA, movePattern: MOVE_STATIONARY, hitboxScale: 0.9, baseScore: 130 },
    { name: 'ゴーレム１', image: 'enemy_spn_1', hp: 75, atk: 20, def: 12, freq: 3, attackPattern: ATTACK_4WAY, movePattern: MOVE_DIAGONAL, hitboxScale: 0.9, baseScore: 150 },

    // ----- ランク2 -----
    { name: 'スライム２', image: 'enemy_ptn_2', hp: 40, atk: 15, def: 4, freq: 2, attackPattern: ATTACK_AIMED, movePattern: MOVE_STATIONARY, hitboxScale: 1.0, baseScore: 100 },
    { name: 'ゴブリン２', image: 'enemy_etc_2', hp: 65, atk: 22, def: 7, freq: 2, attackPattern: ATTACK_4WAY, movePattern: MOVE_HORIZONTAL, hitboxScale: 0.9, baseScore: 120 },
    { name: 'アーチャー２', image: 'enemy_ll_2', hp: 55, atk: 27, def: 5, freq: 2, attackPattern: ATTACK_DIAGONAL_4WAY, movePattern: MOVE_VERTICAL, hitboxScale: 0.8, baseScore: 130 },
    { name: 'ウィザード２', image: 'enemy_blk_2', hp: 70, atk: 34, def: 8, freq: 3, attackPattern: ATTACK_AREA, movePattern: MOVE_ZIGZAG, hitboxScale: 0.8, baseScore: 140 },
    { name: 'ゴーレム２', image: 'enemy_spn_2', hp: 100, atk: 26, def: 16, freq: 2, attackPattern: ATTACK_LASER_90, movePattern: MOVE_DIAGONAL, hitboxScale: 0.9, baseScore: 160 },

    // ----- ランク3 -----
    { name: 'スライム３', image: 'enemy_ptn_3', hp: 58, atk: 20, def: 6, freq: 2, attackPattern: ATTACK_LASER_90, movePattern: MOVE_STATIONARY, hitboxScale: 1.0, baseScore: 110 },
    { name: 'ゴブリン３', image: 'enemy_etc_3', hp: 90, atk: 30, def: 10, freq: 2, attackPattern: ATTACK_DIAGONAL_4WAY, movePattern: MOVE_HORIZONTAL, hitboxScale: 1.0, baseScore: 130 },
    { name: 'アーチャー３', image: 'enemy_ll_3', hp: 75, atk: 36, def: 7, freq: 2, attackPattern: ATTACK_4WAY, movePattern: MOVE_VERTICAL, hitboxScale: 1.0, baseScore: 140 },
    { name: 'ウィザード３', image: 'enemy_blk_3', hp: 95, atk: 44, def: 11, freq: 3, attackPattern: ATTACK_AREA, movePattern: MOVE_ZIGZAG, hitboxScale: 1.0, baseScore: 150 },
    { name: 'ゴーレム３', image: 'enemy_spn_3', hp: 140, atk: 34, def: 22, freq: 2, attackPattern: ATTACK_8WAY, movePattern: MOVE_DIAGONAL, hitboxScale: 0.9, baseScore: 170 },

    // ----- ランク4（終盤） -----
    { name: 'スライム４', image: 'enemy_ptn_4', hp: 80, atk: 28, def: 8, freq: 2, attackPattern: ATTACK_LASER_180, movePattern: MOVE_STATIONARY, hitboxScale: 0.9, baseScore: 120 },
    { name: 'ゴブリン４', image: 'enemy_etc_4', hp: 125, atk: 40, def: 14, freq: 2, attackPattern: ATTACK_DIAGONAL_4WAY, movePattern: MOVE_HORIZONTAL, hitboxScale: 1.0, baseScore: 140 },
    { name: 'アーチャー４', image: 'enemy_ll_4', hp: 100, atk: 48, def: 10, freq: 2, attackPattern: ATTACK_4WAY, movePattern: MOVE_VERTICAL, hitboxScale: 1.0, baseScore: 150 },
    { name: 'ウィザード４', image: 'enemy_blk_4', hp: 130, atk: 58, def: 15, freq: 2, attackPattern: ATTACK_AREA, movePattern: MOVE_ZIGZAG, hitboxScale: 0.9, baseScore: 160 },
    { name: 'ゴーレム４', image: 'enemy_spn_4', hp: 190, atk: 44, def: 30, freq: 2, attackPattern: ATTACK_8WAY, movePattern: MOVE_DIAGONAL, hitboxScale: 0.9, baseScore: 180 }
];

// 10種類の固定ボス定義 (10, 20, 30 ... 100ステージに出現)
// ボスHP/ATK/DEFは段階的に上昇するよう調整
// 50以降は追加ボス(0.75倍)が出現するため、本体は急激な跳ね上がりを抑える
// sizeScale: 通常敵(高さ80)に対する倍率。2=従来どおり / 3 / 4 を指定可能
// hitboxScale（任意）: 見た目に対する当たり判定の縮小率。未指定時は1.0
// baseScore（任意）: 撃破時の基本スコア。未指定時は通常敵100 / ボス150
const BOSS_DEFINITIONS = [
    { stage: 10, name: 'ＧＯ−ＨＡＮ', image: 'boss_gohan', hp: 150, atk: 18, def: 5, freq: 3, sizePattern: [ATTACK_AIMED, ATTACK_VERTICAL, ATTACK_HORIZONTAL], movePattern: MOVE_STATIONARY, sizeScale: 2, hitboxScale: 0.7, baseScore: 300 },
    { stage: 20, name: '食いしん坊', image: 'boss_glutton', hp: 220, atk: 22, def: 8, freq: 3, attackPattern: [ATTACK_VERTICAL, ATTACK_HORIZONTAL, ATTACK_DIAGONAL_4WAY], movePattern: MOVE_HORIZONTAL, sizeScale: 2, hitboxScale: 0.7, baseScore: 400 },
    { stage: 30, name: 'てのひらサイズ', image: 'boss_small', hp: 280, atk: 28, def: 10, freq: 3, attackPattern: [ATTACK_LASER_90, ATTACK_AREA], movePattern: MOVE_STATIONARY, sizeScale: 1, hitboxScale: 0.8, baseScore: 500 },
    { stage: 40, name: 'コウイカ', image: 'boss_ika', hp: 350, atk: 32, def: 12, freq: 3, attackPattern: [ATTACK_VERTICAL, ATTACK_HORIZONTAL, ATTACK_LASER_90], movePattern: MOVE_VERTICAL, sizeScale: 2, hitboxScale: 0.7, baseScore: 600 },
    { stage: 50, name: '刺客', image: 'boss_assassin', hp: 500, atk: 38, def: 25, freq: 3, attackPattern: [ATTACK_FULL_SCREEN, ATTACK_4WAY, ATTACK_SUMMON], movePattern: MOVE_STATIONARY, sizeScale: 3, hitboxScale: 0.7, baseScore: 800 },
    { stage: 60, name: '究極完全態', image: 'boss_perfect', hp: 650, atk: 45, def: 18, freq: 2, attackPattern: [ATTACK_LASER_180, ATTACK_LASER_90, ATTACK_LASER_90, ATTACK_8WAY], movePattern: MOVE_STATIONARY, sizeScale: 3, hitboxScale: 0.8, baseScore: 1000 },
    { stage: 70, name: '赤ちゃん', image: 'boss_baby', hp: 800, atk: 52, def: 20, freq: 2, attackPattern: [ATTACK_AREA, ATTACK_4WAY, ATTACK_DIAGONAL_4WAY, ATTACK_SUMMON], movePattern: MOVE_HORIZONTAL, sizeScale: 1, hitboxScale: 0.7, baseScore: 1200 },
    { stage: 80, name: '女子', image: 'boss_girl', hp: 1000, atk: 60, def: 22, freq: 2, attackPattern: [ATTACK_LASER_180, ATTACK_LASER_180, ATTACK_LASER_90, ATTACK_AREA, ATTACK_8WAY, ATTACK_AIMED], movePattern: MOVE_STATIONARY, sizeScale: 3, hitboxScale: 0.7, baseScore: 1500 },
    { stage: 90, name: '忍者', image: 'boss_ninja', hp: 1250, atk: 70, def: 30, freq: 2, attackPattern: [ATTACK_FULL_SCREEN, ATTACK_LASER_90, ATTACK_4WAY, ATTACK_DIAGONAL_4WAY, ATTACK_8WAY, ATTACK_SUMMON], movePattern: MOVE_VERTICAL, sizeScale: 2, hitboxScale: 0.6, baseScore: 2000 },
    { stage: 100, name: 'じっしゃ版', image: 'boss_last', hp: 1800, atk: 85, def: 35, freq: 2, attackPattern: [ATTACK_FULL_SCREEN, ATTACK_LASER_180, ATTACK_AREA, ATTACK_8WAY, ATTACK_SUMMON], movePattern: MOVE_STATIONARY, sizeScale: 4, hitboxScale: 0.9, baseScore: 3000 }
];

// ==========================================
// プレイヤークラス (スプライト・60x60縮小表示)
// ==========================================
phina.define('Player', {
    superClass: 'Sprite',
    init: function () {
        this.superInit('playerImage');
        this.setSize(60, 60);
        this.radius = 30; // 距離判定・衝突判定用の半径プロパティ
        this.stats = { hp: 100, maxHp: 100, atk: 10, def: 5, spd: 30, splitLevel: 0, shotgunLevel: 0, areaLevel: 0, pierceLevel: 0, healOnKillLevel: 0, shieldLevel: 0 };
        this.physical.friction = 0.96;
        this.hitEnemies = []; // 貫通時の「同一ショット中同一敵1回まで」判定用リスト（非貫通時は複数ヒット可）
        this.hiddenAtkMult = 1.0; // 隠し攻撃力倍率（特定名前で上昇。ステータス表示には出さない）
        this.shieldCount = 0; // 現在のシールド残数
        this.resetPosition();
    },
    resetPosition: function () {
        this.x = SCREEN_W / 2;
        this.y = LIMIT_BOTTOM - 100;
        this.physical.velocity.set(0, 0);
        this.hitEnemies = [];
    }
});

// ==========================================
// 分裂プレイヤークラス
// ==========================================
phina.define('SplitPlayer', {
    superClass: 'Sprite',
    init: function (x, y, vx, vy, atk) {
        this.superInit('playerImage');
        this.setSize(36, 36);
        this.radius = 18;
        this.setPosition(x, y);
        this.physical.velocity.set(vx, vy);
        this.physical.friction = 0.96;
        this.atk = atk;
    }
});

// ==========================================
// プレイヤーの散弾クラス
// ==========================================
phina.define('PlayerBullet', {
    superClass: 'CircleShape',
    init: function (x, y, vx, vy, atk) {
        this.superInit({ radius: 8, fill: '#00ffff', stroke: 'white', strokeWidth: 2 });
        this.setPosition(x, y);
        this.physical.velocity.set(vx, vy);
        this.atk = atk;
    }
});

// ==========================================
// プレイヤーの範囲攻撃クラス
// ==========================================
phina.define('PlayerAreaAttack', {
    superClass: 'CircleShape',
    init: function (x, y, atk) {
        this.superInit({ radius: 90, fill: 'rgba(0, 255, 255, 0.2)', stroke: '#00ffff', strokeWidth: 3 });
        this.setPosition(x, y);
        this.atk = atk;
        this.timer = 45;
        this.isExploded = false;
        this.hasDamaged = false;
        this.tweener.to({ alpha: 0.6 }, 150).to({ alpha: 0.2 }, 150).setLoop(true).play();
    },
    update: function () {
        if (this.isExploded) return;
        this.timer--;
        if (this.timer <= 0) {
            this.isExploded = true;
            this.tweener.clear();
            this.fill = 'rgba(0, 200, 255, 0.8)';
            this.stroke = 'white';
            this.radius = 110;
            playSe('area_explode');
            this.tweener.wait(200).call(() => { this.remove(); }).play();
        }
    }
});

// ==========================================
// HP回復アイテムクラス (Sprite + setFrameIndex)
// ==========================================
phina.define('HealItem', {
    superClass: 'Sprite',
    init: function (level) {
        this.superInit('heal_item_sheet', 64, 64);
        this.setSize(52, 52);
        this.radius = 26;

        this.level = level;
        this.healRatio = level * 0.1;

        this.setFrameIndex(level - 1, 64, 64);

        this.tweener.moveBy(0, -6, 600, 'easeInOutQuad').moveBy(0, 6, 600, 'easeInOutQuad').setLoop(true).play();
    }
});

// ==========================================
// 障害物クラス (Sprite + setFrameIndex)
// ==========================================
phina.define('Obstacle', {
    superClass: 'Sprite',
    init: function (stageNum) {
        this.superInit('obstacle_sheet', 64, 64);
        this.setSize(60, 60);
        this.radius = 30;

        this.maxHp = 20 + (stageNum * 5);
        this.hp = this.maxHp;
        this.isExplosive = false;

        this.label = Label({ text: '', fill: 'white', fontFamily: FONT_FAMILY, fontSize: 18, fontWeight: 'bold' }).addChildTo(this);
        this.updateLabel();
    },
    updateLabel: function () {
        let ratio = this.hp / this.maxHp;
        let lv = Math.min(4, Math.floor(ratio * 5));
        if (lv < 0) lv = 0;

        let offset = this.isExplosive ? 5 : 0;
        let frameIndex = lv + offset;

        this.setFrameIndex(frameIndex, 64, 64);
        // Lv表示は出さず、爆発障害物のみ💥を表示
        this.label.text = this.isExplosive ? "💥" : "";
    },
    damage: function (amount, scene) {
        this.hp -= amount;
        if (this.hp <= 0) {
            this.hp = 0;
            playSe('explosion');
            if (scene) {
                // 障害物サイズに合わせた爆発スプライト
                let expSize = Math.max(this.width, this.height);
                scene.spawnExplosion(this.x, this.y, expSize);
                if (this.isExplosive) {
                    scene.spawnObstacleExplosion(this.x, this.y);
                }
            }
            this.remove();
        } else {
            this.updateLabel();
            this.tweener.clear().moveBy(5, 0, 50).moveBy(-5, 0, 50).play();
        }
    },
    // canvasのアンチエイリアスを無効にするためにdrawメソッドをオーバーライドする
    draw: function (canvas) {
        canvas.save();                          //canvasの状態をスタックに保存
        canvas.imageSmoothingEnabled = false;   //拡大時の補完を無効にする
        this.superMethod('draw', canvas);       //Spriteのdrawメソッド呼び出し
        canvas.restore();                       //他に影響が出ないように状態を戻す
    },
});

// ==========================================
// 爆発障害物クラス
// ==========================================
phina.define('ExplosiveObstacle', {
    superClass: 'Obstacle',
    init: function (stageNum) {
        this.superInit(stageNum);
        this.isExplosive = true;
        this.updateLabel();
    }
});

// ==========================================
// 敵の弾・レーザー・エリア攻撃クラス
// ==========================================
phina.define('EnemyBullet', {
    superClass: 'CircleShape',
    init: function (x, y, vx, vy, atk) {
        this.superInit({ radius: 12, fill: '#ff8800', stroke: 'white', strokeWidth: 2 });
        this.setPosition(x, y);
        this.physical.velocity.set(vx, vy);
        this.atk = atk;
    }
});

phina.define('EnemyLaser', {
    superClass: 'RectangleShape',
    // angle: ラジアン（発射方向） / waveId: 同一扇状攻撃の識別子
    init: function (x, y, angle, atk, waveId) {
        let dist = 1200;

        this.superInit({
            width: dist,
            height: 12,
            fill: '#ff3366',
            stroke: 'white',
            strokeWidth: 2,
            originX: 0,
            originY: 0.5
        });

        this.setPosition(x, y);
        this.rotation = angle * (180 / Math.PI);
        this.atk = atk;
        this.waveId = waveId != null ? waveId : 0;
        // 判定半径は見た目のアニメに依存させず固定（heightは演出専用）
        this.hitHalfWidth = 14;

        this.targetPoint = {
            x: x + Math.cos(angle) * dist,
            y: y + Math.sin(angle) * dist
        };

        this.tweener
            .to({ height: 28, alpha: 0.9 }, 80)
            .to({ height: 0, alpha: 0 }, 120)
            .call(() => { this.remove(); })
            .play();
    },

    checkHit: function (player) {
        let x1 = this.x, y1 = this.y;
        let x2 = this.targetPoint.x, y2 = this.targetPoint.y;
        let px = player.x, py = player.y;

        let l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (l2 === 0) return false;
        let t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2));
        let projX = x1 + t * (x2 - x1);
        let projY = y1 + t * (y2 - y1);

        let dist = Math.hypot(px - projX, py - projY);
        return dist < player.radius + this.hitHalfWidth;
    }
});

phina.define('AreaAttack', {
    superClass: 'CircleShape',
    init: function (x, y, atk) {
        this.superInit({ radius: 90, fill: 'rgba(255, 0, 0, 0.2)', stroke: 'red', strokeWidth: 3 });
        this.setPosition(x, y);
        this.atk = atk;
        this.timer = 45;
        this.isExploded = false;
        this.hasDamaged = false;
        this.tweener.to({ alpha: 0.6 }, 150).to({ alpha: 0.2 }, 150).setLoop(true).play();
    },
    update: function () {
        if (this.isExploded) return;
        this.timer--;
        if (this.timer <= 0) {
            this.isExploded = true;
            this.tweener.clear();
            this.fill = 'rgba(255, 100, 0, 0.8)';
            this.stroke = 'orange';
            this.radius = 110;
            this.tweener.wait(200).call(() => { this.remove(); }).play();
        }
    }
});

// ==========================================
// 敵クラス (Sprite化・高さ基準のアスペクト比自動調整)
// ==========================================
phina.define('Enemy', {
    superClass: 'Sprite',
    init: function (def, level) {
        // 画像キーで初期化
        this.superInit(def.image);

        let isBoss = !!def.isBoss;
        this.isBoss = isBoss;

        // 高さ(height)を基準にしてサイズを決める
        // 通常敵=80 / ボスは sizeScale 倍（未指定時は2倍=160）。3倍・4倍も指定可
        const NORMAL_ENEMY_HEIGHT = 80;
        let sizeScale = isBoss ? (def.sizeScale || 2) : 1;
        let targetHeight = NORMAL_ENEMY_HEIGHT * sizeScale;

        // 元画像のアスペクト比（幅/高さ）を計算して適切な幅を設定
        let aspectRatio = (this.height > 0) ? (this.width / this.height) : 1.0;
        let targetWidth = targetHeight * aspectRatio;
        this.setSize(targetWidth, targetHeight);

        // hitboxScale: 見た目に対する当たり判定の縮小率（定義で指定、未指定時1.0）
        this.hitboxScale = (def.hitboxScale != null) ? def.hitboxScale : 1.0;

        // 当たり判定半径は高さの半分 × hitboxScale（距離判定・押し出し用）
        this.radius = (targetHeight / 2) * this.hitboxScale;

        // デバッグ: hitboxScale 適用後の矩形を半透明で表示
        if (DEBUG_SHOW_HITBOX) {
            this.debugHitbox = RectangleShape({
                width: targetWidth * this.hitboxScale,
                height: targetHeight * this.hitboxScale,
                fill: 'rgba(255, 0, 0, 0.15)',
                stroke: 'rgba(255, 50, 50, 0.9)',
                strokeWidth: 2
            }).addChildTo(this);
        }

        let hpBoost = isBoss ? def.hp : (def.hp + (level * 5));
        let patterns = Array.isArray(def.attackPattern) ? def.attackPattern : [def.attackPattern];

        this.stats = {
            hp: hpBoost,
            atk: def.atk + (isBoss ? 0 : level * 2),
            def: def.def + (isBoss ? 0 : level),
            freq: def.freq,
            attackPatterns: patterns
        };
        this.maxHp = this.stats.hp;
        this.turnCount = this.stats.freq;
        this.movePattern = def.movePattern;
        // 撃破時の基本スコア（定義で指定、未指定時は通常敵100 / ボス150）
        // ※10点刻みでしか点が入らないので1の桁が必ず0だったので1/10する
        this.baseScore = Math.floor(((def.baseScore != null) ? def.baseScore : (isBoss ? 150 : 100)) / 10);
        this.contactCooldown = 0; // 接触ダメージの再発生までの待機フレーム数

        let speed = 2 + Math.random() * 2;
        if (this.movePattern === MOVE_HORIZONTAL) {
            this.vx = (Math.random() > 0.5 ? speed : -speed);
            this.vy = 0;
        } else if (this.movePattern === MOVE_VERTICAL) {
            this.vx = 0;
            this.vy = (Math.random() > 0.5 ? speed : -speed);
        } else if (this.movePattern === MOVE_DIAGONAL) {
            // 斜め4方向のいずれかをランダムに選択し、速度を正規化して一定速にする
            this.vx = (Math.random() > 0.5 ? speed : -speed);
            this.vy = (Math.random() > 0.5 ? speed : -speed);
            let len = Math.hypot(this.vx, this.vy);
            this.vx = (this.vx / len) * speed;
            this.vy = (this.vy / len) * speed;
        } else if (this.movePattern === MOVE_ZIGZAG) {
            // ジグザグ移動の初期状態：最初は右へ移動するところからスタート
            this.zigzagSpeed = speed;
            this.zigzagHDir = 1;         // 横方向: 1=右 / -1=左
            this.zigzagVDir = 1;         // 縦方向: 1=下段へ / -1=上段へ（下端到達後に反転）
            this.zigzagPhase = 'horizontal'; // 'horizontal'=左右移動中 / 'vertical'=一段移動中
            this.zigzagStepRemain = 0;   // 一段移動の残り距離
            this.vx = speed;
            this.vy = 0;
        } else {
            this.vx = 0;
            this.vy = 0;
        }

        // UI（HPバーを足元、残りターン数をその右側に配置。名前は表示しない）
        let fontSizeSub = isBoss ? 40 : 30;
        let barWidth = Math.max(targetWidth, 80); // バーが極端に狭くならないよう調整
        let barHeight = isBoss ? 12 : 8;
        let barY = targetHeight / 2 + 10; // 足元側

        this.hpBarBg = RectangleShape({
            width: barWidth,
            height: barHeight,
            fill: '#555',
            stroke: 'black',
            strokeWidth: 1,
            y: barY
        }).addChildTo(this);

        this.hpBar = RectangleShape({
            width: barWidth,
            height: barHeight,
            fill: isBoss ? '#ff1111' : '#33cc33',
            strokeWidth: 0,
            originX: 0,
            x: -barWidth / 2,
            y: barY
        }).addChildTo(this);

        // 残りターン数は数字のみ、HPゲージの右側に配置
        this.turnLabel = Label({
            text: '' + this.turnCount,
            fill: '#ffcc00',
            fontFamily: FONT_FAMILY,
            fontSize: fontSizeSub,
            fontWeight: 'bold',
            align: 'left',
            x: barWidth / 2 + 8,
            y: barY
        }).addChildTo(this);
    },
    // canvasのアンチエイリアスを無効にするためにdrawメソッドをオーバーライドする
    draw: function (canvas) {
        canvas.save();                          //canvasの状態をスタックに保存
        canvas.imageSmoothingEnabled = false;   //拡大時の補完を無効にする
        this.superMethod('draw', canvas);       //Spriteのdrawメソッド呼び出し
        canvas.restore();                       //他に影響が出ないように状態を戻す
    },
    damage: function (amount) {
        applyDamage(this, amount);
        playSe('hit');

        let ratio = this.stats.hp / this.maxHp;
        this.hpBar.scaleX = Math.max(0, ratio);
    },
    updateTurn: function () {
        this.turnCount--;
        if (this.turnCount <= 0) {
            this.turnCount = this.stats.freq;
            this.turnLabel.text = '' + this.turnCount;
            return true;
        }
        this.turnLabel.text = '' + this.turnCount;
        return false;
    },
    update: function (app) {
        let scene = app.currentScene;
        if (!scene || !scene.obstacleGroup || scene.gameState === GAME_STATE.MENU || scene.gameState === GAME_STATE.GAME_OVER) return;

        if (this.movePattern === MOVE_VERTICAL || this.movePattern === MOVE_HORIZONTAL || this.movePattern === MOVE_DIAGONAL) {
            this.x += this.vx;
            this.y += this.vy;

            let vel = Vector2(this.vx, this.vy);
            reflectInBounds(this, vel);
            this.vx = vel.x;
            this.vy = vel.y;
        } else if (this.movePattern === MOVE_ZIGZAG) {
            this.updateZigzag();
        }

        // 障害物との衝突で反射（斜め移動にも対応：相対位置から主軸を判定して反転）
        scene.obstacleGroup.children.concat().forEach(obs => {
            if (hitTestWithHitbox(this, obs)) {
                let dx = this.x - obs.x;
                let dy = this.y - obs.y;
                if (Math.abs(dx) > Math.abs(dy)) {
                    this.vx *= -1;
                    this.x += this.vx * 3;
                    // ジグザグ移動中は横方向の状態も合わせて反転させ、ズレを防ぐ
                    if (this.movePattern === MOVE_ZIGZAG && this.zigzagPhase === 'horizontal') {
                        this.zigzagHDir *= -1;
                    }
                } else {
                    this.vy *= -1;
                    this.y += this.vy * 3;
                    if (this.movePattern === MOVE_ZIGZAG && this.zigzagPhase === 'vertical') {
                        this.zigzagVDir *= -1;
                    }
                }
            }
        });

        if (this.contactCooldown > 0) this.contactCooldown--;

        if (scene.gameState === GAME_STATE.WAIT || scene.gameState === GAME_STATE.PULLING) {
            let p = scene.player;
            if (hitTestWithHitbox(this, p) && this.contactCooldown <= 0) {
                this.contactCooldown = CONTACT_DAMAGE_INTERVAL;

                if (typeof scene.damagePlayer === 'function') {
                    scene.damagePlayer(calcDamage(this.stats.atk, p.stats.def));
                } else {
                    applyDamage(p, calcDamage(this.stats.atk, p.stats.def));
                    playSe('damage');
                }
                scene.updateStatusUI();

                // 移動型の敵はプレイヤーとの接触で反射（斜め移動対応）
                if (this.movePattern === MOVE_VERTICAL || this.movePattern === MOVE_HORIZONTAL || this.movePattern === MOVE_DIAGONAL || this.movePattern === MOVE_ZIGZAG) {
                    let dx = this.x - p.x;
                    let dy = this.y - p.y;
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.vx *= -1;
                        this.x += this.vx * 3;
                        if (this.movePattern === MOVE_ZIGZAG && this.zigzagPhase === 'horizontal') {
                            this.zigzagHDir *= -1;
                        }
                    } else {
                        this.vy *= -1;
                        this.y += this.vy * 3;
                        if (this.movePattern === MOVE_ZIGZAG && this.zigzagPhase === 'vertical') {
                            this.zigzagVDir *= -1;
                        }
                    }
                }

                // 静止型の敵は反発しないため、プレイヤーを押し出して重なりを解消する
                if (this.movePattern === MOVE_STATIONARY) {
                    let push = Vector2(p.x - this.x, p.y - this.y);
                    if (push.length() === 0) push = Vector2(0, 1);
                    let sep = push.normalize().mul(this.radius + p.radius + 4);
                    p.x = Math.clamp(this.x + sep.x, LIMIT_LEFT + p.radius, LIMIT_RIGHT - p.radius);
                    p.y = Math.clamp(this.y + sep.y, LIMIT_TOP + p.radius, LIMIT_BOTTOM - p.radius);
                }

                if (p.stats.hp <= 0) scene.checkGameOver();
            }
        }
    },
    // ジグザグ移動（MOVE_ZIGZAG）専用の更新処理
    // 右へ移動→右端で一段下へ→左へ移動→左端で一段下へ→右へ…を繰り返し、
    // 下端まで来たら縦方向を反転し、同じ左右ジグザグを上方向へ辿りながら繰り返す
    updateZigzag: function () {
        if (this.zigzagPhase === 'horizontal') {
            this.x += this.vx;

            if (this.zigzagHDir > 0 && this.right >= LIMIT_RIGHT) {
                // 右へ移動できなくなった → 一段下（または上）へ移動するフェーズへ
                this.right = LIMIT_RIGHT;
                this.startZigzagStep();
            } else if (this.zigzagHDir < 0 && this.left <= LIMIT_LEFT) {
                // 左へ移動できなくなった → 一段下（または上）へ移動するフェーズへ
                this.left = LIMIT_LEFT;
                this.startZigzagStep();
            }
        } else {
            // 一段分の縦移動中（this.vyを実際の移動方向に同期しておく。
            // これにより障害物・プレイヤー接触時の押し出し処理（this.vy*3）が正しく機能する）
            this.vy = this.zigzagSpeed * this.zigzagVDir;
            let step = Math.min(this.zigzagSpeed, this.zigzagStepRemain);
            this.y += step * this.zigzagVDir;
            this.zigzagStepRemain -= step;

            // 下端 / 上端に到達したら縦方向を反転（下へ移動できなくなったら上へ、その逆も同様）
            if (this.zigzagVDir > 0 && this.bottom >= LIMIT_BOTTOM) {
                this.bottom = LIMIT_BOTTOM;
                this.zigzagVDir = -1;
                this.zigzagStepRemain = 0;
            } else if (this.zigzagVDir < 0 && this.top <= LIMIT_TOP) {
                this.top = LIMIT_TOP;
                this.zigzagVDir = 1;
                this.zigzagStepRemain = 0;
            }

            if (this.zigzagStepRemain <= 0) {
                // 一段移動完了 → 横方向を反転して左右移動フェーズへ戻る
                this.zigzagHDir *= -1;
                this.vx = this.zigzagSpeed * this.zigzagHDir;
                this.vy = 0;
                this.zigzagPhase = 'horizontal';
            }
        }
    },
    // 左右移動フェーズ→一段移動フェーズへの切り替え
    startZigzagStep: function () {
        this.zigzagPhase = 'vertical';
        this.zigzagStepRemain = TILE_SIZE; // 一段 = TILE_SIZE分だけ縦移動
        this.vx = 0;
    }
});

// ==========================================
// ローディングシーン
// ==========================================
phina.define('LoadingScene', {
    superClass: 'DisplayScene',

    init: function (options) {
        this.superInit(options);
        // 背景色
        var self = this;
        var loader = phina.asset.AssetLoader();

        // 明滅するラベル
        let label = phina.display.Label({
            text: "",
            fontFamily: FONT_FAMILY,
            fontSize: 64,
            fill: 'white',
        }).addChildTo(this).setPosition(SCREEN_CENTER_X, SCREEN_CENTER_Y);

        // ロードが進行したときの処理
        loader.onprogress = function (e) {
            // 進捗具合を％で表示する
            label.text = "{0}%".format((e.progress * 100).toFixed(0));
        };

        // ローダーによるロード完了ハンドラ
        loader.onload = function () {
            // Appコアにロード完了を伝える（==次のSceneへ移行）
            self.flare('loaded');
        };

        // ロード開始
        loader.load(options.assets);
    },
});

// ==========================================
// 初期化シーン
// ==========================================
phina.define("InitScene", {
    // 継承
    superClass: 'DisplayScene',
    // 初期化
    init: function (option) {
        // 親クラス初期化
        this.superInit(option);
        this.font1 = false;
        this.font2 = false;
    },
    update: function (app) {
        // フォント読み込み待ち
        var self = this;
        document.fonts.load('10pt "misaki_gothic"').then(function () {
            self.font1 = true;
        });
        document.fonts.load('10pt "icomoon"').then(function () {
            self.font2 = true;
        });
        if (this.font1 && this.font2) {
            self.exit();
        }
    }
});

// ==========================================
// タイトルシーン
// ==========================================
phina.define('TitleScene', {
    superClass: 'DisplayScene',
    init: function () {
        this.superInit({ width: SCREEN_W, height: SCREEN_H });
        this.backgroundColor = '#222';

        Label({
            text: 'Hematite Smash',
            fill: '#fff',
            fontFamily: FONT_FAMILY,
            fontSize: 72,
            fontWeight: 'bold',
            align: 'center',
            lineSpacing: 1.2
        }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H / 4);
        Label({
            text: VERSION_STR,
            fill: '#fff',
            fontFamily: FONT_FAMILY,
            fontSize: 32,
            fontWeight: 'bold',
            align: 'right',
            lineSpacing: 1.2
        }).addChildTo(this).setPosition(SCREEN_W - 60, SCREEN_H / 4 + 38);

        Label({
            text: 'なまえをきめよう',
            fill: 'white',
            fontFamily: FONT_FAMILY,
            fontSize: 22,
            align: 'center'
        }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H / 2 - 100);

        this.lockedCount = 0;
        this.nameSlots = ['', '', '', ''];
        this.slotIndices = [];
        this.slotFrames = [];
        this.slotLabels = [];
        this.spinTimer = 0;
        this.nameConfirmed = false;

        let slotY = SCREEN_H / 2 - 20;
        let slotW = 72;
        let slotH = 88;
        let gap = 16;
        let totalW = NAME_LENGTH * slotW + (NAME_LENGTH - 1) * gap;
        let startX = SCREEN_W / 2 - totalW / 2 + slotW / 2;

        for (let i = 0; i < NAME_LENGTH; i++) {
            let x = startX + i * (slotW + gap);
            let frame = RectangleShape({
                width: slotW,
                height: slotH,
                fill: 'rgba(0, 0, 0, 0.55)',
                stroke: '#000',
                strokeWidth: 3,
                cornerRadius: 8
            }).addChildTo(this).setPosition(x, slotY);
            this.slotFrames.push(frame);

            let idx = Math.floor(Math.random() * NAME_CHARS.length);
            this.slotIndices.push(idx);

            let label = Label({
                text: NAME_CHARS[idx],
                fill: '#fff',
                fontFamily: FONT_FAMILY,
                fontSize: 42,
                fontWeight: 'bold',
                align: 'center'
            }).addChildTo(this).setPosition(x, slotY);
            this.slotLabels.push(label);
        }

        this.actionButton = Button({
            text: 'きめる',
            width: 280,
            height: 70,
            fill: '#444',
            fontColor: '#fff',
            fontFamily: FONT_FAMILY,
            fontSize: 28,
            fontWeight: 'bold',
            cornerRadius: 10
        }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H * 2 / 3);

        this.actionButton.onpointend = () => this.onActionButton();

        // セーブデータがある場合は「続きから」ボタンを表示
        if (hasSaveData()) {
            this.continueButton = Button({
                text: 'つづきから',
                width: 280,
                height: 70,
                fill: '#444',
                fontColor: 'white',
                fontFamily: FONT_FAMILY,
                fontSize: 28,
                fontWeight: 'bold',
                cornerRadius: 10
            }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H * 2 / 3 + 90);

            this.continueButton.onpointend = () => {
                let data = loadGame();
                if (data) {
                    this.exit('main', { continueData: data });
                }
            };
        }
    },

    onActionButton: function () {
        if (this.nameConfirmed) {
            let playerName = this.nameSlots.join('');
            this.exit('main', { playerName: playerName });
            return;
        }

        if (this.lockedCount >= NAME_LENGTH) return;

        let i = this.lockedCount;
        let ch = this.slotLabels[i].text;
        this.nameSlots[i] = ch;
        this.slotLabels[i].fill = '#fff';
        this.slotFrames[i].stroke = '#000';
        this.lockedCount++;

        if (this.lockedCount >= NAME_LENGTH) {
            this.nameConfirmed = true;
            this.actionButton.text = 'はじめる';
            this.actionButton.fill = '#444';
        }
    },

    update: function () {
        if (this.lockedCount >= NAME_LENGTH) return;

        this.spinTimer++;
        if (this.spinTimer < NAME_SLOT_SPIN_INTERVAL) return;
        this.spinTimer = 0;

        for (let i = this.lockedCount; i < NAME_LENGTH; i++) {
            this.slotIndices[i] = (this.slotIndices[i] + 1) % NAME_CHARS.length;
            this.slotLabels[i].text = NAME_CHARS[this.slotIndices[i]];
        }
    }
});

// ==========================================
// メインシーン
// ==========================================
phina.define('MainScene', {
    superClass: 'DisplayScene',
    init: function (p) {
        this.superInit({ width: SCREEN_W, height: SCREEN_H });
        this.backgroundColor = '#333';
        this.playerName = (p && p.playerName) ? p.playerName : '????';
        this.stageNum = 1;
        this.score = 0;
        this.gameState = GAME_STATE.WAIT;
        this.laserWaveId = 0;            // レーザー波の識別子（発射ごとに加算）
        this.laserDamagedWaves = {};     // ダメージ済みの波ID（多段ヒット防止）

        this.bgGroup = DisplayElement().addChildTo(this);
        this.areaAttackGroup = DisplayElement().addChildTo(this);
        this.healItemGroup = DisplayElement().addChildTo(this);
        this.obstacleGroup = DisplayElement().addChildTo(this);
        this.enemyGroup = DisplayElement().addChildTo(this);
        this.enemyBulletGroup = DisplayElement().addChildTo(this);
        this.enemyLaserGroup = DisplayElement().addChildTo(this);
        this.splitGroup = DisplayElement().addChildTo(this);
        this.playerBulletGroup = DisplayElement().addChildTo(this);
        this.playerAreaAttackGroup = DisplayElement().addChildTo(this);
        this.effectGroup = DisplayElement().addChildTo(this);
        this.player = Player().addChildTo(this);
        this.uiGroup = DisplayElement().addChildTo(this);

        // 名前に応じたステータスパターンを決定（新規・続き共通で参照用）
        this.namePattern = getNamePattern(this.playerName);
        this.statPattern = getStatPattern(this.namePattern);

        // 続きからの場合はセーブデータを適用。開始後はセーブを削除（新規・続きから共通）
        if (p && p.continueData) {
            let d = p.continueData;
            this.playerName = d.playerName || this.playerName;
            // 続きからでも名前が変わっている可能性があるのでパターンを再計算
            this.namePattern = getNamePattern(this.playerName);
            this.statPattern = getStatPattern(this.namePattern);
            this.stageNum = d.stageNum || 1;
            this.score = d.score || 0;
            if (d.stats) {
                Object.assign(this.player.stats, d.stats);
                // HPが最大を超えないよう補正
                this.player.stats.hp = Math.min(this.player.stats.hp, this.player.stats.maxHp);
            }
        } else {
            // 新規ゲーム: パターンに応じた初期ステータスを適用
            let init = this.statPattern.init;
            this.player.stats.hp = init.hp;
            this.player.stats.maxHp = init.maxHp;
            this.player.stats.atk = init.atk;
            this.player.stats.def = init.def;
            this.player.stats.spd = init.spd;
        }
        deleteSave();

        // 特定の名前の場合、隠し攻撃力倍率を上げる（ステータス表示のATKはそのまま）
        if (BONUS_NAMES.includes(this.playerName)) {
            this.player.hiddenAtkMult = 1.2; // 実質 +20%（基本ATK10相当で+2）
        }

        this.dragLine = DisplayElement().addChildTo(this);
        this.dragLine.draw = function (canvas) {
            let scene = this.parent;
            if (scene.gameState !== GAME_STATE.PULLING) return;

            let p = scene.app.pointer;
            let ctx = canvas.context;
            let px = scene.player.x, py = scene.player.y;
            let mx = p.x, my = p.y;

            let dx = mx - px;
            let dy = my - py;
            let dist = Math.hypot(dx, dy);
            if (dist < 10) return;

            let angle = Math.atan2(dy, dx) + Math.PI;
            let powerRatio = Math.min(1.0, dist / 200);
            scene.lastDragPowerRatio = powerRatio;
            let arrowLength = Math.min(dist * 1.2, 220);

            let tox = px + Math.cos(angle) * arrowLength;
            let toy = py + Math.sin(angle) * arrowLength;

            ctx.save();

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 3;
            ctx.setLineDash([6, 6]);
            ctx.moveTo(px, py);
            ctx.lineTo(mx, my);
            ctx.stroke();
            ctx.setLineDash([]);

            let mainColor, lightColor;
            if (powerRatio > 0.7) {
                mainColor = '#ff0055';
                lightColor = '#ffaaee';
            } else if (powerRatio > 0.3) {
                mainColor = '#ffcc00';
                lightColor = '#ffffaa';
            } else {
                mainColor = '#00ffff';
                lightColor = '#aaffff';
            }

            ctx.shadowColor = mainColor;
            ctx.shadowBlur = 12 + powerRatio * 8;

            let grad = ctx.createLinearGradient(px, py, tox, toy);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
            grad.addColorStop(0.4, mainColor);
            grad.addColorStop(1, mainColor);

            ctx.beginPath();
            ctx.strokeStyle = grad;
            ctx.lineWidth = 8 + powerRatio * 6;
            ctx.lineCap = 'round';
            ctx.moveTo(px, py);
            ctx.lineTo(tox, toy);
            ctx.stroke();

            let headLen = 22 + powerRatio * 8;
            let headAngle = Math.PI / 5.5;

            ctx.beginPath();
            ctx.fillStyle = mainColor;
            ctx.moveTo(tox, toy);
            ctx.lineTo(
                tox - headLen * Math.cos(angle - headAngle),
                toy - headLen * Math.sin(angle - headAngle)
            );
            ctx.lineTo(
                tox - (headLen * 0.65) * Math.cos(angle),
                toy - (headLen * 0.65) * Math.sin(angle)
            );
            ctx.lineTo(
                tox - headLen * Math.cos(angle + headAngle),
                toy - headLen * Math.sin(angle + headAngle)
            );
            ctx.closePath();
            ctx.fill();

            let numChevrons = 3;
            ctx.shadowBlur = 4;
            ctx.shadowColor = lightColor;

            for (let i = 1; i <= numChevrons; i++) {
                let ratio = i / (numChevrons + 1);
                let cx = px + (tox - px) * ratio;
                let cy = py + (toy - py) * ratio;
                let cLen = 8 + powerRatio * 4;

                ctx.beginPath();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.lineJoin = 'miter';
                ctx.moveTo(
                    cx - cLen * Math.cos(angle - headAngle),
                    cy - cLen * Math.sin(angle - headAngle)
                );
                ctx.lineTo(cx, cy);
                ctx.lineTo(
                    cx - cLen * Math.cos(angle + headAngle),
                    cy - cLen * Math.sin(angle + headAngle)
                );
                ctx.stroke();
            }

            ctx.restore();
        };

        // タイミングゲージUI
        this.gaugeBar = DisplayElement().addChildTo(this.uiGroup).setPosition(SCREEN_W / 2, 40);
        this.gaugeBar.gaugeValue = 0;
        this.gaugeBar.draw = function (canvas) {
            let ctx = canvas.context;
            ctx.save();

            let w = 400, h = 22;
            let x = -w / 2, y = -h / 2;
            let val = this.gaugeValue;

            ctx.fillStyle = 'rgba(15, 20, 30, 0.9)';
            ctx.strokeStyle = '#00ccff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 8, y - 6);
            ctx.lineTo(x + w + 8, y - 6);
            ctx.lineTo(x + w + 14, y + h + 6);
            ctx.lineTo(x - 14, y + h + 6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            let bgGrad = ctx.createLinearGradient(x, 0, x + w, 0);
            bgGrad.addColorStop(0.0, '#002233');
            bgGrad.addColorStop(0.5, '#332200');
            bgGrad.addColorStop(0.85, '#440011');
            bgGrad.addColorStop(1.0, '#880022');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(x, y, w, h);

            if (val > 0) {
                let activeW = w * val;
                let fillGrad = ctx.createLinearGradient(x, 0, x + activeW, 0);
                fillGrad.addColorStop(0.0, '#00ffff');
                fillGrad.addColorStop(0.6, '#ffcc00');
                fillGrad.addColorStop(1.0, '#ff0055');

                ctx.shadowColor = (val > 0.85) ? '#ff0055' : (val > 0.4 ? '#ffcc00' : '#00ffff');
                ctx.shadowBlur = 10;
                ctx.fillStyle = fillGrad;
                ctx.fillRect(x, y, activeW, h);
                ctx.shadowBlur = 0;
            }

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1.5;
            for (let i = 1; i < 10; i++) {
                let tx = x + (w * (i / 10));
                ctx.beginPath();
                ctx.moveTo(tx, y);
                ctx.lineTo(tx, y + (i % 5 === 0 ? h : h * 0.5));
                ctx.stroke();
            }

            ctx.strokeStyle = 'rgba(255, 0, 85, 0.8)';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + w * 0.85, y, w * 0.15, h);

            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('SMASH', x + w * 0.925, y + h / 2);

            let indX = x + (w * val);
            let themeColor = (val > 0.85) ? '#ff0055' : (val > 0.4 ? '#ffcc00' : '#00ffff');

            ctx.shadowColor = themeColor;
            ctx.shadowBlur = 15;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(indX, y - 6);
            ctx.lineTo(indX, y + h + 6);
            ctx.stroke();

            ctx.fillStyle = themeColor;
            let drawDiamond = (cx, cy) => {
                ctx.beginPath();
                ctx.moveTo(cx, cy - 4);
                ctx.lineTo(cx + 4, cy);
                ctx.lineTo(cx, cy + 4);
                ctx.lineTo(cx - 4, cy);
                ctx.closePath();
                ctx.fill();
            };
            drawDiamond(indX, y - 6);
            drawDiamond(indX, y + h + 6);

            ctx.restore();
        };

        this.gaugeValue = 0;
        this.gaugeDir = 1;
        this.currentMultiplier = 1.0;
        this.lastDragPowerRatio = 0;
        this.burstBoostActive = false;
        this.burstGhostTimer = 0;
        this.comboCount = 0; // 連続ヒット数（1ヒットごとに攻撃力1.1倍）
        this.isShaking = false; // 画面揺らしの重複実行を防ぐフラグ
        this.shotCount = 0; // 今ステージの攻撃（射出）回数
        this.killsThisShot = 0; // 今ショット中の撃破数（多体撃破ボーナス用）
        this.initialEnemyCount = 0; // ステージ開始時の敵数（クリアボーナス基準用）

        // 下部ステータス表示エリア（LabelAreaで固定領域・上揃えにして行数変化によるズレを防ぐ）
        this.statusBg = RectangleShape({ width: SCREEN_W, height: 110, fill: 'rgba(0,0,0,0.8)' }).addChildTo(this.uiGroup).setPosition(SCREEN_W / 2, SCREEN_H - 55);
        this.statusLabel = LabelArea({
            text: '',
            width: SCREEN_W - 40,
            height: 90,
            fill: 'white',
            fontFamily: FONT_FAMILY,
            fontSize: 25,
            align: 'left',
            verticalAlign: 'top',
            lineSpace: 1.3
        }).addChildTo(this.uiGroup).setPosition(SCREEN_W / 2, SCREEN_H - 55);
        this.stageLabel = Label({ text: '', fill: 'white', fontFamily: FONT_FAMILY, fontSize: 44, fontWeight: 'bold' }).addChildTo(this.uiGroup).setPosition(SCREEN_W / 2, SCREEN_H / 2);

        this.setupStage();

        this.on('pointstart', this.onPointStart);
        this.on('pointend', this.onPointEnd);

        this.fadeMask = RectangleShape({ width: SCREEN_W, height: SCREEN_H, fill: 'black', strokeWidth: 0 }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H / 2);
        this.fadeMask.alpha = 1.0;

        this.startFadeIn();
    },

    spawnPlayerBurstGhost: function (dir) {
        if (!dir || !this.effectGroup) return;

        let ghost = Sprite('playerImage').addChildTo(this.effectGroup);
        ghost.setSize(this.player.width, this.player.height);
        ghost.setPosition(this.player.x, this.player.y);
        ghost.alpha = 0.8;
        ghost.rotation = this.player.rotation || 0;

        ghost.tweener.clear()
            .to({
                x: this.player.x - dir.x * BURST_GHOST_OFFSET,
                y: this.player.y - dir.y * BURST_GHOST_OFFSET,
                alpha: 0,
                scaleX: 1.35,
                scaleY: 1.35,
            }, BURST_GHOST_LIFETIME)
            .call(() => ghost.remove())
            .play();
    },

    startFadeIn: function () {
        this.gameState = GAME_STATE.FADE_IN;
        this.updateStatusUI();
        this.fadeMask.tweener.clear()
            .set({ alpha: 1.0 }).wait(80).set({ alpha: 0.8 }).wait(80).set({ alpha: 0.6 }).wait(80)
            .set({ alpha: 0.4 }).wait(80).set({ alpha: 0.2 }).wait(80).set({ alpha: 0.0 })
            .call(() => { this.gameState = GAME_STATE.WAIT; this.resetGauge(); }).play();
    },

    startFadeOut: function () {
        this.gameState = GAME_STATE.FADE_OUT;
        // クリア時：攻撃回数が少ないほど高得点のボーナスを加算
        this.applyClearBonus();
        if (this.stageNum >= MAX_STAGE) {
            this.exit('result', {
                playerName: this.playerName,
                stageNum: this.stageNum,
                score: this.score,
                cleared: true
            });
            return;
        }
        this.fadeMask.tweener.clear()
            .set({ alpha: 0.0 }).wait(80).set({ alpha: 0.2 }).wait(80).set({ alpha: 0.4 }).wait(80)
            .set({ alpha: 0.6 }).wait(80).set({ alpha: 0.8 }).wait(80).set({ alpha: 1.0 }).wait(200)
            .call(() => { this.stageClearMenu(); }).play();
    },

    // クリア時ボーナス：基準攻撃回数より少ないほど高得点
    // 基準 = max(2, 初期敵数) ／ 効率 = 基準 / 実際の攻撃回数
    applyClearBonus: function () {
        let baseline = Math.max(2, this.initialEnemyCount || 2);
        let shots = Math.max(1, this.shotCount || 1);
        let efficiency = Math.max(0.5, baseline / shots);
        // 基礎クリア点 × ステージ × 効率
        let bonus = Math.floor(80 * this.stageNum * efficiency);
        // 基準を下回った分の追加ボーナス（1発少ないごとに加算）
        let underPar = Math.max(0, baseline - shots);
        bonus += underPar * 40 * this.stageNum;
        this.score += bonus;
        this.updateStatusUI();
    },

    getStageConfig: function (stageNum) {
        let config = STAGE_DEFINITIONS.find(cfg => stageNum >= cfg.start && stageNum <= cfg.end);
        if (!config) config = STAGE_DEFINITIONS[STAGE_DEFINITIONS.length - 1];
        return config;
    },

    getRandomHealItemLevel: function () {
        let rand = Math.random();
        if (rand < 0.40) return 1;
        if (rand < 0.70) return 2;
        if (rand < 0.90) return 3;
        return 4;
    },

    // セル帯の中から空き位置を探して配置する。配置できたら true
    placeInZone: function (obj, grid, rowMin, rowMax, margin, jitter) {
        let cells = grid.shuffledCells(rowMin, rowMax);
        for (let i = 0; i < cells.length; i++) {
            let cx = LIMIT_LEFT + cells[i].col * TILE_SIZE + TILE_SIZE / 2;
            let cy = LIMIT_TOP + cells[i].row * TILE_SIZE + TILE_SIZE / 2;
            // グリッド感を消すためのランダムジッター
            let jx = jitter ? Math.randint(-jitter, jitter) : 0;
            let jy = jitter ? Math.randint(-jitter, jitter) : 0;
            if (grid.canPlace(cx + jx, cy + jy, obj.radius, margin)) {
                grid.reserve(cx + jx, cy + jy, obj.radius, margin);
                obj.setPosition(cx + jx, cy + jy);
                return true;
            }
            // ジッターでダメならセル中心でも試す
            if (grid.canPlace(cx, cy, obj.radius, margin)) {
                grid.reserve(cx, cy, obj.radius, margin);
                obj.setPosition(cx, cy);
                return true;
            }
        }
        return false;
    },

    setupStage: function () {
        this.bgGroup.children.clear();
        this.enemyGroup.children.clear();
        this.enemyBulletGroup.children.clear();
        this.enemyLaserGroup.children.clear();
        this.areaAttackGroup.children.clear();
        this.healItemGroup.children.clear();
        this.obstacleGroup.children.clear();
        this.splitGroup.children.clear();
        this.playerBulletGroup.children.clear();
        this.playerAreaAttackGroup.children.clear();
        this.effectGroup.children.clear();
        this.laserDamagedWaves = {};
        this.player.resetPosition();

        let bossDef = BOSS_DEFINITIONS.find(b => b.stage === this.stageNum);
        let isBossStage = !!bossDef;

        // 追加ボス数を先に計算して表示用に使う
        let extraBossCount = 0;
        if (isBossStage) {
            if (this.stageNum >= 80) extraBossCount = 2;           // 合計3体
            else if (this.stageNum >= 70) extraBossCount = 1;     // 合計2体
            else if (this.stageNum >= 60) extraBossCount = (Math.random() < 0.5) ? 1 : 0; // 確率で2体
        }

        this.stageLabel.text = `ちか ${this.stageNum} かい`;
        this.stageLabel.tweener.clear().set({ alpha: 0 }).to({ alpha: 1 }, 250).wait(500).to({ alpha: 0 }, 300).play();

        let step = Math.floor((this.stageNum - 1) / 10);
        let cacheName = 'floor_brick_' + step;

        if (!phina.asset.AssetManager.get('image', cacheName)) {
            let ratio = Math.min(1.0, step / 9);
            let lerpColor = (start, end, r) => {
                let res = start.map((sVal, i) => Math.floor(sVal + (end[i] - sVal) * r));
                return `rgb(${res[0]}, ${res[1]}, ${res[2]})`;
            };

            let startShadow = [0, 43, 23]; let startBase = [0, 86, 46]; let startLight = [43, 129, 89];
            let endShadow = [4, 0, 65]; let endBase = [48, 0, 109]; let endLight = [92, 44, 153];

            let cShadow = lerpColor(startShadow, endShadow, ratio);
            let cBase = lerpColor(startBase, endBase, ratio);
            let cLight = lerpColor(startLight, endLight, ratio);

            let canvas = phina.graphics.Canvas().setSize(64, 64);
            let ctx = canvas.context;
            ctx.fillStyle = cShadow; ctx.fillRect(0, 0, 64, 64);
            for (let row = 0; row < 4; row++) {
                let y = row * 16; let xOff = (row % 2) * 16;
                for (let col = -1; col < 3; col++) {
                    let x = col * 32 + xOff;
                    ctx.fillStyle = cBase; ctx.fillRect(x + 1, y + 1, 30, 14);
                    ctx.fillStyle = cLight; ctx.fillRect(x + 1, y + 1, 30, 2); ctx.fillRect(x + 1, y + 1, 2, 14);
                }
            }
            phina.asset.AssetManager.set('image', cacheName, canvas);
        }

        let cols = SCREEN_W / TILE_SIZE;
        let rows = SCREEN_H / TILE_SIZE;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                let isOuter = (col === 0 || col === cols - 1 || row === 0 || row === rows - 2 || row === rows - 1);
                let textureName = isOuter ? 'gray_brick' : cacheName;
                Sprite(textureName)
                    .addChildTo(this.bgGroup)
                    .setPosition(col * TILE_SIZE + TILE_SIZE / 2, row * TILE_SIZE + TILE_SIZE / 2);
            }
        }

        let stageConfig = this.getStageConfig(this.stageNum);

        // ---- 出現させる敵リストを組み立てる（配置前に確定）----
        let enemiesToSpawn = [];
        if (isBossStage) {
            // メインボス（このステージのボス）
            let bossData = Object.assign({}, bossDef, { isBoss: true });
            enemiesToSpawn.push(bossData);

            // 追加ボス
            // stage 90: 過去ボスではなく、このステージのボス（忍者）を複数体出現
            // それ以外: 過去のボスから選出・重複なし（0.75倍に弱体化）
            if (this.stageNum === 90) {
                for (let i = 0; i < extraBossCount; i++) {
                    let extraBoss = Object.assign({}, bossDef, {
                        isBoss: true,
                        hp: bossDef.hp,
                        atk: bossDef.atk,
                        def: bossDef.def
                    });
                    enemiesToSpawn.push(extraBoss);
                }
            } else {
                let previousBosses = BOSS_DEFINITIONS.filter(b => b.stage < this.stageNum);
                for (let i = 0; i < extraBossCount && previousBosses.length > 0; i++) {
                    let idx = Math.randint(0, previousBosses.length - 1);
                    let extraDef = previousBosses.splice(idx, 1)[0];
                    // 追加ボスは少し弱体化（HP・攻撃・防御を0.75倍）
                    let extraBoss = Object.assign({}, extraDef, {
                        isBoss: true,
                        hp: Math.floor(extraDef.hp * 0.75),
                        atk: Math.floor(extraDef.atk * 0.75),
                        def: Math.floor(extraDef.def * 0.75)
                    });
                    enemiesToSpawn.push(extraBoss);
                }
            }

            let normalCount = Math.randint(stageConfig.minEnemies, stageConfig.maxEnemies);
            for (let i = 0; i < normalCount; i++) {
                let allowedEnemies = stageConfig.enemies;
                let randomIndex = Math.randint(0, allowedEnemies.length - 1);
                let enemyDef = ENEMY_DEFINITIONS.find(def => def.name === allowedEnemies[randomIndex]) || ENEMY_DEFINITIONS[0];
                enemiesToSpawn.push(enemyDef);
            }
        } else {
            let enemyCount = Math.randint(stageConfig.minEnemies, stageConfig.maxEnemies);
            for (let i = 0; i < enemyCount; i++) {
                let allowedEnemies = stageConfig.enemies;
                let randomIndex = Math.randint(0, allowedEnemies.length - 1);
                let enemyDef = ENEMY_DEFINITIONS.find(def => def.name === allowedEnemies[randomIndex]) || ENEMY_DEFINITIONS[0];
                enemiesToSpawn.push(enemyDef);
            }
        }

        // ---- 配置管理グリッド ----
        let grid = createPlacementGrid();
        // プレイヤー初期位置の周辺は安全圏として先に予約
        grid.reserve(this.player.x, this.player.y, this.player.radius, 90);

        // ---- 1. ボス（大きい順にアンカーへ配置）----
        let bosses = enemiesToSpawn.filter(d => d.isBoss)
            .map(d => Enemy(d, this.stageNum))
            .sort((a, b) => b.radius - a.radius);
        let normalDefs = enemiesToSpawn.filter(d => !d.isBoss);

        bosses.forEach(boss => {
            let placed = false;
            for (let i = 0; i < BOSS_ANCHORS.length && !placed; i++) {
                let a = BOSS_ANCHORS[i];
                let x = LIMIT_LEFT + a.fx * (LIMIT_RIGHT - LIMIT_LEFT);
                let y = LIMIT_TOP + a.fy * (LIMIT_BOTTOM - LIMIT_TOP);
                // 体が可動領域に収まるようクランプ（ボスは上寄せ）
                x = Math.clamp(x, LIMIT_LEFT + boss.radius, LIMIT_RIGHT - boss.radius);
                y = Math.clamp(y, LIMIT_TOP + boss.radius + 8, LIMIT_TOP + 380);
                if (grid.canPlace(x, y, boss.radius, 8)) {
                    grid.reserve(x, y, boss.radius, 8);
                    boss.setPosition(x, y);
                    placed = true;
                }
            }
            // アンカーで置けない場合は帯スキャン（マージンを段階的に緩和）
            if (!placed) placed = this.placeInZone(boss, grid, 0, 5, 8, 0);
            if (!placed) placed = this.placeInZone(boss, grid, 0, 7, 4, 0);
            if (!placed) placed = this.placeInZone(boss, grid, 0, 9, 0, 0);
            if (placed) boss.addChildTo(this.enemyGroup);
        });

        // ---- 2. 通常敵（大きい順に敵帯へ配置）----
        normalDefs.map(d => Enemy(d, this.stageNum))
            .sort((a, b) => b.radius - a.radius)
            .forEach(enemy => {
                let placed = this.placeInZone(enemy, grid, 1, 7, 12, 12);
                if (!placed) placed = this.placeInZone(enemy, grid, 0, 8, 8, 8);
                if (!placed) placed = this.placeInZone(enemy, grid, 0, 9, 0, 0);
                if (placed) enemy.addChildTo(this.enemyGroup);
            });

        // ---- 3. 障害物（中盤の反射ルート帯へ配置）----
        let normalObsCount = Math.randint(stageConfig.minNormalObs, stageConfig.maxNormalObs);
        let explosiveObsCount = Math.randint(stageConfig.minExplosiveObs, stageConfig.maxExplosiveObs);

        let spawnObstacleType = (type, count) => {
            for (let i = 0; i < count; i++) {
                let obs = (type === 'explosive') ? ExplosiveObstacle(this.stageNum) : Obstacle(this.stageNum);
                let placed = this.placeInZone(obs, grid, 4, 8, 0, 0);
                if (!placed) placed = this.placeInZone(obs, grid, 2, 9, 0, 0);
                if (placed) obs.addChildTo(this.obstacleGroup);
            }
        };
        spawnObstacleType('normal', normalObsCount);
        spawnObstacleType('explosive', explosiveObsCount);

        // ---- 4. 回復アイテム（残った隙間へ）----
        // 特定の名前の場合はHP回復アイテム出現率を倍にする（通常10% → 20%）
        let healSpawnRate = BONUS_NAMES.includes(this.playerName) ? 0.20 : 0.10;
        if (Math.random() < healSpawnRate) {
            let item = HealItem(this.getRandomHealItemLevel());
            let placed = this.placeInZone(item, grid, 3, 8, 4, 0);
            if (!placed) placed = this.placeInZone(item, grid, 1, 9, 0, 0);
            if (placed) item.addChildTo(this.healItemGroup);
        }

        // スコア用：攻撃回数・多体撃破のカウンタをリセットし、初期敵数を記録
        this.shotCount = 0;
        this.killsThisShot = 0;
        this.initialEnemyCount = this.enemyGroup.children.length;

        this.updateStatusUI();
    },

    // 敵・障害物破壊時の爆発スプライト（size は対象の見た目サイズに合わせる）
    spawnExplosion: function (x, y, size) {
        let s = Math.max(24, size || 48);
        Explosion(x, y, s).addChildTo(this.effectGroup);
    },

    spawnObstacleExplosion: function (x, y) {
        let exp = CircleShape({
            radius: 10, fill: 'rgba(255, 68, 0, 0.5)', stroke: '#ffcc00', strokeWidth: 4, x: x, y: y
        }).addChildTo(this);

        exp.tweener.to({ radius: 150, alpha: 0 }, 300, 'easeOutQuad').call(() => { exp.remove(); }).play();

        let dist = Vector2.distance(this.player, Vector2(x, y));
        if (dist < 150 + this.player.radius) {
            let expDamage = 15 + Math.floor(this.stageNum * 1.5);
            this.damagePlayer(expDamage);
            this.updateStatusUI();

            this.shakeScreen();

            if (this.player.stats.hp <= 0) this.checkGameOver();
        }
    },

    // 画面を揺らす。シーン全体のtweenerをclearせず、揺らし中の重複呼び出しは無視する
    shakeScreen: function () {
        if (this.isShaking) return;
        this.isShaking = true;

        let baseX = this.x;
        let baseY = this.y;

        this.tweener
            .moveBy(10, 5, 40)
            .moveBy(-20, -10, 40)
            .moveBy(10, 5, 40)
            .call(() => {
                // 累積誤差でシーンがずれないよう元の位置に戻す
                // DisplayScene には setPosition がないため x/y を直接代入する
                this.x = baseX;
                this.y = baseY;
                this.isShaking = false;
            })
            .play();
    },

    updateStatusUI: function () {
        const p = this.player.stats;
        let stageText = `ちか ${this.stageNum} かい`;
        // スキルは獲得済み（Lv1以上）のものだけ表示
        let skillParts = [];
        if (p.splitLevel > 0) skillParts.push(`ぶんれつ:Lv.${p.splitLevel}`);
        if (p.shotgunLevel > 0) skillParts.push(`さんだん:Lv.${p.shotgunLevel}`);
        if (p.areaLevel > 0) skillParts.push(`はんい:Lv.${p.areaLevel}`);
        if (p.pierceLevel > 0) skillParts.push(`かんつう:Lv.${p.pierceLevel}`);
        if (p.healOnKillLevel > 0) skillParts.push(`キルゲイン:Lv.${p.healOnKillLevel}`);
        if (p.shieldLevel > 0) skillParts.push(`シールド:${this.player.shieldCount}/${p.shieldLevel}`);
        let skillLine = skillParts.length > 0 ? '\n' + skillParts.join('  ') : '';
        this.statusLabel.text = `${stageText}  ${this.score}ガバス\nHP: ${p.hp}/${p.maxHp}  ATK: ${p.atk}  DEF: ${p.def}  SPD: ${p.spd}${skillLine}`;

        // HP残量でステータス表示色を変更
        let hpRatio = (p.maxHp > 0) ? (p.hp / p.maxHp) : 0;
        if (hpRatio > 0.5) {
            this.statusLabel.fill = 'white';       // 余裕
        } else if (hpRatio > 0.25) {
            this.statusLabel.fill = '#ffcc00';     // 注意（黄）
        } else {
            this.statusLabel.fill = '#ff4444';     // 危険（赤）
        }
    },

    onPointStart: function (e) {
        if (this.gameState !== GAME_STATE.WAIT) return;
        if (this.player.hitTest(e.pointer.x, e.pointer.y)) this.gameState = GAME_STATE.PULLING;
    },

    onPointEnd: function (e) {
        if (this.gameState !== GAME_STATE.PULLING) return;
        let dx = this.player.x - e.pointer.x, dy = this.player.y - e.pointer.y;
        let vec = Vector2(dx, dy);
        if (vec.length() > 10) {
            this.gameState = GAME_STATE.MOVING;
            this.player.hitEnemies = [];
            this.comboCount = 0;
            this.shotCount++;
            this.killsThisShot = 0;

            let len = vec.length();
            let dir = vec.normalize();
            let speed = Math.min(len * 0.2 * (this.player.stats.spd / 10), 50);
            let burstBoost = this.lastDragPowerRatio > 0.7 && this.gaugeValue > 0.95;

            if (burstBoost) {
                speed *= BURST_BOOST_SPEED_MULTIPLIER;
                this.burstBoostActive = true;
                this.burstGhostTimer = 0;
                this.spawnPlayerBurstGhost(dir);
            }

            this.player.physical.velocity = dir.mul(speed);

            playSe('launch');
        } else {
            this.gameState = GAME_STATE.WAIT;
        }
    },

    defeatEnemy: function (enemy, baseScore) {
        // 1ショット多体撃破ボーナス: 1体目=1.0倍, 2体目=1.5倍, 3体目=2.0倍...
        this.killsThisShot = (this.killsThisShot || 0) + 1;
        let multiKillMult = 1 + (this.killsThisShot - 1) * 0.5;
        this.score += Math.floor(baseScore * this.stageNum * multiKillMult);

        // 撃破SE（通常敵 / ボスで出し分け）
        if (enemy.isBoss) {
            playSe('defeat_boss');
        } else {
            playSe('defeat_enemy');
        }

        // 撃破回復: Lvに応じてHPを微回復
        let healLv = this.player.stats.healOnKillLevel || 0;
        if (healLv > 0) {
            let healAmount = 1 * healLv;
            // ボス撃破時は少し多めに回復
            if (enemy.isBoss) healAmount = Math.floor(healAmount * 1.5);
            this.player.stats.hp = Math.min(this.player.stats.maxHp, this.player.stats.hp + healAmount);
            playSe('get');
        }

        this.updateStatusUI();

        // 撃破位置に敵サイズに合わせた爆発スプライト
        let expSize = Math.max(enemy.width, enemy.height);
        this.spawnExplosion(enemy.x, enemy.y, expSize);

        // ボス撃破時：残りのボスがいなければ雑魚を一掃（複数ボス対応）
        if (enemy.isBoss) {
            let remainingBosses = this.enemyGroup.children.filter(e => e !== enemy && e.isBoss);
            if (remainingBosses.length === 0) {
                this.enemyGroup.children.concat().forEach(other => {
                    if (other !== enemy) {
                        let otherSize = Math.max(other.width, other.height);
                        this.spawnExplosion(other.x, other.y, otherSize);
                        other.remove();
                    }
                });
            }
        }
        enemy.remove();
    },

    update: function (app) {
        if (this.gameState === GAME_STATE.PULLING) {
            this.gaugeValue += 0.03 * this.gaugeDir;
            if (this.gaugeValue > 1 || this.gaugeValue < 0) this.gaugeDir *= -1;
            this.gaugeValue = Math.max(0, Math.min(1, this.gaugeValue));

            this.gaugeBar.gaugeValue = this.gaugeValue;
            this.currentMultiplier = 1.0 + (this.gaugeValue * 1.5); // 1.0倍～2.5倍
        }
        if (this.gameState === GAME_STATE.MOVING) {
            this.handleCollisions();
            this.handleSplitObjects();
            this.handlePlayerBullets();
            this.handlePlayerAreaAttacks();

            if (this.burstBoostActive) {
                let v = this.player.physical.velocity;
                if (v.length() > 0.9) {
                    this.burstGhostTimer += app.ticker.deltaTime;
                    if (this.burstGhostTimer >= BURST_GHOST_SPAWN_INTERVAL) {
                        let dir = Vector2(v.x, v.y).normalize();
                        if (dir.length() > 0.0) this.spawnPlayerBurstGhost(dir);
                        this.burstGhostTimer = 0;
                    }
                } else {
                    this.burstBoostActive = false;
                }
            }

            if (this.player.physical.velocity.length() > 0 && this.player.physical.velocity.length() < PLAYER_STOP_THRESHOLD) {
                this.player.physical.velocity.set(0, 0);
                this.triggerAreaAttack();
            }

            if (this.player.physical.velocity.length() === 0 &&
                this.splitGroup.children.length === 0 &&
                this.playerBulletGroup.children.length === 0 &&
                this.playerAreaAttackGroup.children.length === 0) {

                if (this.enemyGroup.children.length === 0) {
                    this.startFadeOut();
                } else {
                    this.gameState = GAME_STATE.ENEMY_TURN;
                    this.processEnemyTurn();
                }
            }
        }
        if (this.gameState === GAME_STATE.ENEMY_MOVING) this.handleEnemyObjects();
    },

    fireShotgun: function (x, y) {
        let baseSpeed = 12; let angles = [0, 45, 90, 135, 180, 225, 270, 315];
        let dmgAtk = this.player.stats.atk * getSkillDmgMult(this.player.stats.shotgunLevel) * this.player.hiddenAtkMult;
        for (let i = 0; i < this.player.stats.shotgunLevel; i++) {
            let speed = Math.max(4, baseSpeed - (i * 2));
            angles.forEach(angle => {
                let rad = (angle * Math.PI) / 180;
                PlayerBullet(x, y, Math.cos(rad) * speed, Math.sin(rad) * speed, dmgAtk).addChildTo(this.playerBulletGroup);
            });
        }
    },

    triggerAreaAttack: function () {
        if (this.player.stats.areaLevel <= 0) return;
        let dmgAtk = this.player.stats.atk * getSkillDmgMult(this.player.stats.areaLevel) * this.player.hiddenAtkMult;
        for (let i = 0; i < this.player.stats.areaLevel; i++) {
            let rx = Math.randint(LIMIT_LEFT + 40, LIMIT_RIGHT - 40);
            let ry = Math.randint(LIMIT_TOP + 40, LIMIT_BOTTOM - 40);
            PlayerAreaAttack(rx, ry, dmgAtk).addChildTo(this.playerAreaAttackGroup);
        }
    },

    healPlayer: function (healRatio) {
        let p = this.player.stats;
        let healAmount = Math.floor(p.maxHp * healRatio);
        p.hp = Math.min(p.maxHp, p.hp + healAmount);
        playSe('get');
        this.updateStatusUI();
    },

    // プレイヤー専用ダメージ（シールドがあれば1回分無効化）
    damagePlayer: function (amount) {
        if (this.player.shieldCount > 0) {
            this.player.shieldCount--;
            playSe('reflect');
            this.updateStatusUI();
            return;
        }
        applyDamage(this.player, amount);
        playSe('damage');
    },

    handleCollisions: function () {
        let p = this.player, v = p.physical.velocity;

        this.healItemGroup.children.concat().forEach(item => {
            if (p.hitTestElement(item)) {
                this.healPlayer(item.healRatio);
                item.remove();
            }
        });

        if (v.length() < 0.5) return;

        let hitWall = false;
        if (p.left < LIMIT_LEFT) { p.left = LIMIT_LEFT; v.x *= -1; hitWall = true; }
        else if (p.right > LIMIT_RIGHT) { p.right = LIMIT_RIGHT; v.x *= -1; hitWall = true; }
        if (p.top < LIMIT_TOP) { p.top = LIMIT_TOP; v.y *= -1; hitWall = true; }
        else if (p.bottom > LIMIT_BOTTOM) { p.bottom = LIMIT_BOTTOM; v.y *= -1; hitWall = true; }

        if (hitWall) {
            playSe('reflect');
            this.spawnSplits();
            if (p.stats.shotgunLevel > 0) this.fireShotgun(p.x, p.y);
        }

        this.obstacleGroup.children.concat().forEach(obs => {
            if (p.hitTestElement(obs)) {
                obs.damage(calcDamage(p.stats.atk * this.currentMultiplier * p.hiddenAtkMult, 0), this);
                p.physical.velocity = Vector2(p.x - obs.x, p.y - obs.y).normalize().mul(v.length() * 0.8);
                playSe('reflect');
                this.spawnSplits();
                if (p.stats.shotgunLevel > 0) this.fireShotgun(p.x, p.y);
            }
        });

        this.enemyGroup.children.concat().forEach(enemy => {
            if (hitTestWithHitbox(p, enemy)) {
                // 貫通スキル所持時のみ「同一ショット中は同じ敵に1回まで」を適用
                // （貫通なし時は反射後に再接触すれば複数回ヒット可能）
                let isPierce = p.stats.pierceLevel > 0;
                if (isPierce && p.hitEnemies.includes(enemy)) return;

                if (!p.hitEnemies.includes(enemy)) {
                    p.hitEnemies.push(enemy);
                }
                this.comboCount++;
                // 連続ヒットボーナス: 1ヒット目=1.0倍, 2ヒット目=1.1倍, 3ヒット目=1.21倍...
                let comboMult = Math.pow(1.1, this.comboCount - 1);

                if (isPierce) {
                    let rate = 0.5 + (p.stats.pierceLevel * 0.1);
                    let skillMult = getSkillDmgMult(p.stats.pierceLevel);
                    let atkDamage = calcDamage((p.stats.atk * this.currentMultiplier * comboMult * skillMult * p.hiddenAtkMult) * rate, enemy.stats.def);

                    enemy.damage(atkDamage);

                    // 速度減衰は最大1.0まで（Lv6以上で加速しすぎないよう）
                    p.physical.velocity.mul(Math.min(1.0, rate));

                    if (enemy.stats.hp <= 0) { this.defeatEnemy(enemy, enemy.baseScore); }
                } else {
                    enemy.damage(calcDamage(p.stats.atk * this.currentMultiplier * comboMult * p.hiddenAtkMult, enemy.stats.def));
                    p.physical.velocity = Vector2(p.x - enemy.x, p.y - enemy.y).normalize().mul(v.length() * 0.8);
                    if (enemy.stats.hp <= 0) { this.defeatEnemy(enemy, enemy.baseScore); }
                }
            }
        });
    },

    spawnSplits: function () {
        if (this.player.stats.splitLevel <= 0) return;
        let v = this.player.physical.velocity;
        let dmgAtk = this.player.stats.atk * getSkillDmgMult(this.player.stats.splitLevel) * this.player.hiddenAtkMult;
        for (let i = 0; i < this.player.stats.splitLevel; i++) {
            let angle = Math.atan2(v.y, v.x) + (Math.random() - 0.5);
            SplitPlayer(this.player.x, this.player.y, Math.cos(angle) * v.length(), Math.sin(angle) * v.length(), dmgAtk).addChildTo(this.splitGroup);
        }
    },

    handleSplitObjects: function () {
        this.splitGroup.children.concat().forEach(s => {
            this.healItemGroup.children.concat().forEach(item => {
                if (s.hitTestElement(item)) {
                    this.healPlayer(item.healRatio);
                    item.remove();
                }
            });

            let v = s.physical.velocity; if (v.length() < 0.5) { s.remove(); return; }

            if (reflectInBounds(s, v)) {
                playSe('reflect');
            }

            this.obstacleGroup.children.concat().forEach(obs => {
                if (s.hitTestElement(obs)) {
                    obs.damage(calcDamage(s.atk * 0.5, 0), this);
                    s.physical.velocity = Vector2(s.x - obs.x, s.y - obs.y).normalize().mul(v.length() * 0.8);
                    playSe('reflect');
                }
            });
            this.enemyGroup.children.concat().forEach(enemy => {
                if (hitTestWithHitbox(s, enemy)) {
                    // 分裂体ごとにもヒット済みを管理して連続ダメージを防ぐ
                    if (!s.hitEnemies) s.hitEnemies = [];
                    if (s.hitEnemies.includes(enemy)) return;
                    s.hitEnemies.push(enemy);

                    // メインと共有のリストで連続ヒットボーナスを積む
                    if (!this.player.hitEnemies.includes(enemy)) {
                        this.player.hitEnemies.push(enemy);
                        this.comboCount++;
                    }
                    let comboMult = Math.pow(1.1, Math.max(0, this.comboCount - 1));
                    enemy.damage(calcDamage(s.atk * comboMult, enemy.stats.def));
                    s.physical.velocity = Vector2(s.x - enemy.x, s.y - enemy.y).normalize().mul(v.length() * 0.8);
                    if (enemy.stats.hp <= 0) { this.defeatEnemy(enemy, enemy.baseScore); }
                }
            });
        });
    },

    handlePlayerBullets: function () {
        this.playerBulletGroup.children.concat().forEach(b => {
            if (isOutOfBounds(b)) { b.remove(); return; }

            let hitObstacle = false;
            this.obstacleGroup.children.concat().forEach(obs => {
                if (!hitObstacle && b.hitTestElement(obs)) {
                    obs.damage(calcDamage(b.atk * 0.4, 0), this);
                    b.remove(); hitObstacle = true;
                }
            });
            if (hitObstacle) return;
            let hitEnemy = false;
            this.enemyGroup.children.concat().forEach(enemy => {
                if (!hitEnemy && hitTestWithHitbox(b, enemy)) {
                    if (!this.player.hitEnemies.includes(enemy)) {
                        this.player.hitEnemies.push(enemy);
                        this.comboCount++;
                    }
                    let comboMult = Math.pow(1.1, Math.max(0, this.comboCount - 1));
                    enemy.damage(calcDamage(b.atk * 0.8 * comboMult, enemy.stats.def));
                    b.remove(); hitEnemy = true;
                    if (enemy.stats.hp <= 0) { this.defeatEnemy(enemy, enemy.baseScore); }
                }
            });
        });
    },

    handlePlayerAreaAttacks: function () {
        this.playerAreaAttackGroup.children.concat().forEach(a => {
            if (a.isExploded && !a.hasDamaged) {
                this.enemyGroup.children.concat().forEach(enemy => {
                    if (Vector2.distance(enemy, a) < a.radius + enemy.radius) {
                        if (!this.player.hitEnemies.includes(enemy)) {
                            this.player.hitEnemies.push(enemy);
                            this.comboCount++;
                        }
                        let comboMult = Math.pow(1.1, Math.max(0, this.comboCount - 1));
                        enemy.damage(calcDamage(a.atk * 1.2 * comboMult, enemy.stats.def));
                        if (enemy.stats.hp <= 0) { this.defeatEnemy(enemy, enemy.baseScore); }
                    }
                });
                this.obstacleGroup.children.concat().forEach(obs => {
                    if (Vector2.distance(obs, a) < a.radius + obs.radius) obs.damage(calcDamage(a.atk * 0.8, 0), this);
                });
                a.hasDamaged = true;
            }
        });
    },

    processEnemyTurn: function () {
        if (this.enemyGroup.children.length === 0) { this.startFadeOut(); return; }
        this.enemyGroup.children.concat().forEach(enemy => {
            if (enemy.updateTurn()) {
                let speed = 8; let r = 0.7071;

                let patterns = enemy.stats.attackPatterns;
                let pattern = patterns[Math.floor(Math.random() * patterns.length)];

                if (pattern === ATTACK_FULL_SCREEN) {
                    playSe('area_explode');
                    RectangleShape({ width: LIMIT_RIGHT - LIMIT_LEFT, height: LIMIT_BOTTOM - LIMIT_TOP, fill: 'rgba(255,0,0,0.3)' })
                        .addChildTo(this).setPosition(SCREEN_W / 2, (LIMIT_BOTTOM + LIMIT_TOP) / 2).tweener.to({ alpha: 0 }, 250).call(function () { this.remove(); }).play();
                    this.damagePlayer(calcDamage(enemy.stats.atk, this.player.stats.def));
                } else if (pattern === ATTACK_VERTICAL || pattern === ATTACK_HORIZONTAL) {
                    playSe('enemy_shot');
                    let vx = (pattern === ATTACK_HORIZONTAL) ? speed : 0, vy = (pattern === ATTACK_VERTICAL) ? speed : 0;
                    EnemyBullet(enemy.x, enemy.y, vx, vy, enemy.stats.atk).addChildTo(this.enemyBulletGroup);
                    EnemyBullet(enemy.x, enemy.y, -vx, -vy, enemy.stats.atk).addChildTo(this.enemyBulletGroup);
                } else if (pattern === ATTACK_LASER_90 || pattern === ATTACK_LASER_180) {
                    playSe('laser');
                    // ランダムな開始角度から扇状に複数本のレーザーで攻撃（同一波のダメージは1回のみ）
                    this.laserWaveId++;
                    let waveId = this.laserWaveId;
                    let baseAngle = Math.random() * Math.PI * 2;
                    const spread = pattern === ATTACK_LASER_180 ? Math.PI : Math.PI / 2;   // 180°:90°
                    const numLasers = pattern === ATTACK_LASER_180 ? 18 : 10;
                    for (let i = 0; i < numLasers; i++) {
                        let angle = baseAngle + (spread * i / (numLasers - 1));
                        EnemyLaser(enemy.x, enemy.y, angle, enemy.stats.atk, waveId).addChildTo(this.enemyLaserGroup);
                    }
                } else if (pattern === ATTACK_AREA) {
                    // 爆発SEは AreaAttack.update 内で再生
                    playSe('area_explode');
                    AreaAttack(Math.randint(LIMIT_LEFT + 40, LIMIT_RIGHT - 40), Math.randint(LIMIT_TOP + 40, LIMIT_BOTTOM - 40), enemy.stats.atk).addChildTo(this.areaAttackGroup);
                } else if (pattern === ATTACK_AIMED) {
                    let aim = Vector2(this.player.x - enemy.x, this.player.y - enemy.y);
                    if (aim.length() > 0) {
                        playSe('enemy_shot');
                        let dir = aim.normalize();
                        EnemyBullet(enemy.x, enemy.y, dir.x * speed, dir.y * speed, enemy.stats.atk).addChildTo(this.enemyBulletGroup);
                    }
                } else if (pattern === ATTACK_4WAY) {
                    playSe('enemy_shot');
                    [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].forEach(d => { EnemyBullet(enemy.x, enemy.y, d.x * speed, d.y * speed, enemy.stats.atk).addChildTo(this.enemyBulletGroup); });
                } else if (pattern === ATTACK_DIAGONAL_4WAY) {
                    playSe('enemy_shot');
                    [{ x: r, y: r }, { x: -r, y: r }, { x: r, y: -r }, { x: -r, y: -r }].forEach(d => { EnemyBullet(enemy.x, enemy.y, d.x * speed, d.y * speed, enemy.stats.atk).addChildTo(this.enemyBulletGroup); });
                } else if (pattern === ATTACK_8WAY) {
                    playSe('enemy_shot');
                    [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: r, y: r }, { x: -r, y: r }, { x: r, y: -r }, { x: -r, y: -r }].forEach(d => { EnemyBullet(enemy.x, enemy.y, d.x * speed, d.y * speed, enemy.stats.atk).addChildTo(this.enemyBulletGroup); });
                } else if (pattern === ATTACK_SUMMON) {
                    // ボスの敵召喚攻撃
                    this.spawnSummonedEnemies(enemy);
                }
            }
        });
        this.updateStatusUI();
        if (this.player.stats.hp <= 0) this.checkGameOver();
        else if (this.enemyBulletGroup.children.length > 0 || this.areaAttackGroup.children.length > 0 || this.enemyLaserGroup.children.length > 0) this.gameState = GAME_STATE.ENEMY_MOVING;
        else { this.gameState = GAME_STATE.WAIT; this.resetGauge(); }
    },

    // ボスが通常敵を召喚する（最大2体・フィールド上限を超えない）
    spawnSummonedEnemies: function (boss) {
        const MAX_FIELD_ENEMIES = 8;
        let currentCount = this.enemyGroup.children.length;
        if (currentCount >= MAX_FIELD_ENEMIES) return;

        let stageConfig = this.getStageConfig(this.stageNum);
        let summonCount = Math.min(Math.randint(1, 2), MAX_FIELD_ENEMIES - currentCount);
        let allowedEnemies = stageConfig.enemies;
        let placedCount = 0;

        for (let i = 0; i < summonCount; i++) {
            let enemyDef = ENEMY_DEFINITIONS.find(def => def.name === allowedEnemies[Math.randint(0, allowedEnemies.length - 1)]) || ENEMY_DEFINITIONS[0];
            let summoned = Enemy(enemyDef, this.stageNum);

            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 40) {
                attempts++;
                // ボス周辺 or 上半分のランダム位置
                let angle = Math.random() * Math.PI * 2;
                let dist = 80 + Math.random() * 100;
                let rx = boss.x + Math.cos(angle) * dist;
                let ry = boss.y + Math.sin(angle) * dist;

                // 範囲内にクランプ
                let padding = summoned.radius + 8;
                rx = Math.clamp(rx, LIMIT_LEFT + padding, LIMIT_RIGHT - padding);
                ry = Math.clamp(ry, LIMIT_TOP + padding, LIMIT_TOP + 280);

                summoned.setPosition(rx, ry);

                // 既存の敵・障害物・プレイヤーと重ならないか確認
                let overlapPlayer = Vector2.distance(summoned, this.player) < (summoned.radius + this.player.radius + 30);
                let overlapEnemy = this.enemyGroup.children.some(other => Vector2.distance(summoned, other) < (summoned.radius + other.radius + 16));
                let overlapObs = this.obstacleGroup.children.some(obs => Vector2.distance(summoned, obs) < (summoned.radius + obs.radius + 16));

                if (!overlapPlayer && !overlapEnemy && !overlapObs) {
                    placed = true;
                }
            }

            if (placed) {
                summoned.addChildTo(this.enemyGroup);

                // 召喚演出（簡易フラッシュ）
                let flash = CircleShape({
                    radius: 20,
                    fill: 'rgba(180, 80, 255, 0.6)',
                    stroke: '#cc66ff',
                    strokeWidth: 3,
                    x: summoned.x,
                    y: summoned.y
                }).addChildTo(this);
                flash.tweener.to({ radius: 60, alpha: 0 }, 280, 'easeOutQuad').call(() => { flash.remove(); }).play();
                placedCount++;
            }
        }
        if (placedCount > 0) playSe('summon');
    },

    handleEnemyObjects: function () {
        this.enemyBulletGroup.children.concat().forEach(b => {
            if (this.player.hitTestElement(b)) { this.damagePlayer(calcDamage(b.atk, this.player.stats.def)); b.remove(); }
            this.obstacleGroup.children.concat().forEach(obs => { if (b.hitTestElement(obs)) b.remove(); });
            if (isOutOfBounds(b)) b.remove();
        });

        // 同一 waveId のレーザー群は何本当たってもダメージ1回まで
        this.enemyLaserGroup.children.concat().forEach(laser => {
            if (this.laserDamagedWaves[laser.waveId]) return;
            if (laser.checkHit(this.player)) {
                this.laserDamagedWaves[laser.waveId] = true;
                this.damagePlayer(calcDamage(laser.atk, this.player.stats.def));
            }
        });

        this.areaAttackGroup.children.concat().forEach(a => {
            if (a.isExploded && !a.hasDamaged && Vector2.distance(this.player, a) < a.radius + this.player.radius) { this.damagePlayer(calcDamage(a.atk, this.player.stats.def)); a.hasDamaged = true; }
        });

        this.updateStatusUI();
        if (this.player.stats.hp <= 0) this.checkGameOver();
        if (this.enemyBulletGroup.children.length === 0 && this.areaAttackGroup.children.length === 0 && this.enemyLaserGroup.children.length === 0) {
            this.laserDamagedWaves = {};
            this.gameState = GAME_STATE.WAIT;
            this.resetGauge();
        }
    },

    resetGauge: function () {
        this.gaugeValue = 0;
        this.gaugeDir = 1;
        this.currentMultiplier = 1.0;
        if (this.gaugeBar) this.gaugeBar.gaugeValue = 0;
    },
    checkGameOver: function () {
        // 同一フレーム内の複数被弾などで多重呼び出されても演出は1回だけ
        if (this.gameState === GAME_STATE.MENU || this.gameState === GAME_STATE.GAME_OVER) return;
        this.gameState = GAME_STATE.GAME_OVER;

        // 操作・移動を止める
        this.player.physical.velocity.set(0, 0);

        // 死亡演出: 画面をゆっくり暗転してからリザルトへ
        this.fadeMask.tweener.clear()
            .set({ alpha: 0.0 })
            .to({ alpha: 1.0 }, 1200)
            .wait(300)
            .call(() => {
                this.gameState = GAME_STATE.MENU;
                this.exit('result', {
                    playerName: this.playerName,
                    stageNum: this.stageNum,
                    score: this.score,
                    cleared: false
                });
            })
            .play();
    },

    stageClearMenu: function () {
        this.gameState = GAME_STATE.MENU;
        // 名前パターンに応じたスキル加算値を使用
        const sk = this.statPattern.skill;
        // fill: スキル種別ごとのボタン背景色
        const params = [
            { key: 'maxHp', label: 'さいだいHP +' + sk.maxHp, val: sk.maxHp, fill: '#2e7d32' },       // 緑
            { key: 'atk', label: 'こうげき +' + sk.atk, val: sk.atk, fill: '#c62828' },           // 赤
            { key: 'def', label: 'ぼうぎょ +' + sk.def, val: sk.def, fill: '#1565c0' },           // 青
            { key: 'spd', label: 'そくど +' + sk.spd, val: sk.spd, fill: '#00838f' },         // シアン
            { key: 'healAll', label: 'HPぜんかい', val: true, fill: '#66bb6a' },      // 明るい緑
            { key: 'healOnKillLevel', label: 'キルゲイン +1', val: 1, fill: '#ad1457' } // マゼンタ
        ];

        // シールドは特定の名前の場合、もしくは25 % の確率で選択肢に入れる（上限なし）
        if ((BONUS_NAMES.includes(this.playerName)) || (Math.random() < 0.25)) {
            params.push({ key: 'shieldLevel', label: 'シールド +1', val: 1, fill: '#546e7a' }); // スレート灰
        }

        let hasSplit = this.player.stats.splitLevel > 0;
        let hasShotgun = this.player.stats.shotgunLevel > 0;
        let hasArea = this.player.stats.areaLevel > 0;
        let hasPierce = this.player.stats.pierceLevel > 0;

        let hasAnySkill = hasSplit || hasShotgun || hasArea || hasPierce;

        // スキルは上限なし。未取得時は全候補、取得済みならそのスキルのみ候補に
        if (!hasAnySkill) {
            params.push({ key: 'splitLevel', label: 'ぶんれつ +1', val: 1, fill: '#6a1b9a' });   // 紫
            params.push({ key: 'shotgunLevel', label: 'さんだん +1', val: 1, fill: '#f9a825' }); // 金
            params.push({ key: 'areaLevel', label: 'はんい +1', val: 1, fill: '#ef6c00' });    // 橙
            params.push({ key: 'pierceLevel', label: 'かんつう +1', val: 1, fill: '#00acc1' });  // 水色
        } else {
            if (hasSplit) params.push({ key: 'splitLevel', label: 'ぶんれつ +1', val: 1, fill: '#6a1b9a' });
            if (hasShotgun) params.push({ key: 'shotgunLevel', label: 'さんだん +1', val: 1, fill: '#f9a825' });
            if (hasArea) params.push({ key: 'areaLevel', label: 'はんい +1', val: 1, fill: '#ef6c00' });
            if (hasPierce) params.push({ key: 'pierceLevel', label: 'かんつう +1', val: 1, fill: '#00acc1' });
        }

        let choices = shuffleArray(params).slice(0, 3);
        let panel = RectangleShape({ width: 500, height: 380, fill: 'rgba(20,20,20,0.95)', stroke: 'white', strokeWidth: 2 }).addChildTo(this).setPosition(SCREEN_W / 2, SCREEN_H / 2);
        choices.forEach((c, i) => {
            Button({
                text: c.label,
                fontFamily: FONT_FAMILY,
                width: 250,
                height: 60,
                fill: c.fill || '#555',
                fontColor: 'white'
            }).addChildTo(panel).setPosition(0, -80 + i * 80).onpointend = () => {
                if (c.key === 'healAll') this.player.stats.hp = this.player.stats.maxHp;
                else {
                    this.player.stats[c.key] += c.val;
                    if (c.key === 'maxHp') this.player.stats.hp += c.val;
                    if (c.key === 'shieldLevel') this.player.shieldCount = this.player.stats.shieldLevel;
                }
                this.stageNum++;

                // 次のステージに遷移する直前に自動セーブ
                saveGame({
                    playerName: this.playerName,
                    stageNum: this.stageNum,
                    score: this.score,
                    stats: Object.assign({}, this.player.stats)
                });

                panel.remove();

                this.setupStage();
                this.startFadeIn();
            };
        });
    }
});

// ==========================================
// リザルトシーン
// ==========================================
phina.define('ResultScene', {
    superClass: 'DisplayScene',
    init: function (p) {
        this.superInit({ width: SCREEN_W, height: SCREEN_H });
        this.backgroundColor = 'black';

        // 100面クリア・ゲームオーバーを問わず、リザルト到達時にセーブデータを削除する
        deleteSave();

        let playerName = (p && p.playerName) ? p.playerName : '????';
        let stageNum = (p && p.stageNum != null) ? p.stageNum : 0;
        let score = (p && p.score != null) ? p.score : 0;
        let cleared = !!(p && p.cleared);

        // クリア時は game_clear、それ以外は game_over のスプライトを表示
        let resultImageKey = cleared ? 'game_clear' : 'game_over';
        Sprite(resultImageKey)
            .addChildTo(this)
            .setPosition(SCREEN_W / 2, SCREEN_H / 2 - 170)
            .setScale(3.0);

        // 共有ボタン用
        let postText = null;
        const postURL = "https://iwasaku.github.io/test20/HMSM/";
        const postTags = "#ネムレス #NEMLESSS #HematiteSmash #HMSM";
        let message;
        let tweetStr;
        if (p && p.message) {
            message = p.message;
            tweetStr = p.tweetStr;
        } else if (cleared) {
            message = `${playerName}はちか１００かいをクリアした\n`;
            tweetStr = `地下１００階をクリアした\n`;
        } else {
            message = `${playerName}は　ちか${toZenkaku(stageNum, 1)}かいで　ちからつきた\n`;
            tweetStr = `地下${toZenkaku(stageNum, 1)}階で力尽きた\n`;
            Label({
                text: " R.I.P.\n" + playerName,
                fontSize: 40,
                fontFamily: FONT_FAMILY,
                align: "center",
                baseline: "bottom",
                fill: '#222',
                shadow: "#000",
                shadowBlur: 20,
                x: SCREEN_CENTER_X + 16,
                y: SCREEN_CENTER_Y - 32 * 4,
            }).addChildTo(this).alpha = 0.7;
        }
        if (score > 0) {
            message += toZenkaku(score, 1) + "ガバス　を　かくとく！\n";
            tweetStr += toZenkaku(score, 1) + "ガバスを獲得した！\n";
        }
        tweetStr += `(v${VERSION_STR})`;
        postText = `勇者${playerName}は　${tweetStr}`;

        Label({
            text: message,
            fill: 'white',
            x: 24 * 2,
            y: SCREEN_CENTER_Y + 32 * 10,
            fontFamily: FONT_FAMILY,
            fontSize: 24,
            align: "left",
            lineSpacing: 1.3
        }).addChildTo(this);

        Button({ text: 'もう一度', fontFamily: FONT_FAMILY, fontSize: 32, fill: "#444" }).addChildTo(this)
            .setPosition(SCREEN_CENTER_X + 160, 650)
            .onpointend = () => this.exit();

        // X
        xButton = Button({
            text: String.fromCharCode(0xe902),
            fontFamily: "icomoon",
            fontSize: 32,
            fill: "#444",
            x: SCREEN_CENTER_X - 160 - 76,
            y: 650,
            width: 60,
            height: 60,
        }).addChildTo(this);
        xButton.onclick = function () {
            // https://developer.x.com/en/docs/twitter-for-websites/tweet-button/guides/web-intent
            var shareURL = "https://x.com/intent/tweet?text=" + encodeURIComponent(postText + "\n" + postTags + "\n") + "&url=" + encodeURIComponent(postURL);
            window.open(shareURL, "_blank", "noopener,noreferrer");
        };

        // threads
        threadsButton = Button({
            text: String.fromCharCode(0xe901),
            fontFamily: "icomoon",
            fontSize: 32,
            fill: "#444",
            x: SCREEN_CENTER_X - 160,
            y: 650,
            width: 60,
            height: 60,
        }).addChildTo(this);
        threadsButton.onclick = function () {
            // https://developers.facebook.com/docs/threads/threads-web-intents/
            // web intentでのハッシュタグの扱いが環境（ブラウザ、iOS、Android）によって違いすぎるので『#』を削って通常の文字列にしておく
            var shareURL = "https://www.threads.net/intent/post?text=" + encodeURIComponent(postText + "\n\n" + postTags.replace(/#/g, "")) + "&url=" + encodeURIComponent(postURL);
            window.open(shareURL, "_blank", "noopener,noreferrer");
        };

        // Bluesky
        bskyButton = Button({
            text: String.fromCharCode(0xe900),
            fontFamily: "icomoon",
            fontSize: 32,
            fill: "#444",
            x: SCREEN_CENTER_X - 160 + 76,
            y: 650,
            width: 60,
            height: 60,
        }).addChildTo(this);
        bskyButton.onclick = function () {
            // https://docs.bsky.app/docs/advanced-guides/intent-links
            var shareURL = "https://bsky.app/intent/compose?text=" + encodeURIComponent(postText + "\n" + postTags + "\n" + postURL);
            window.open(shareURL, "_blank", "noopener,noreferrer");
        };

    }
});

// ==========================================
// メインアプリケーション起動
// ==========================================
phina.main(() => {
    let grayCanvas = phina.graphics.Canvas().setSize(64, 64);
    let gCtx = grayCanvas.context;
    gCtx.fillStyle = '#2d2d2d'; gCtx.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 4; row++) {
        let y = row * 16; let xOff = (row % 2) * 16;
        for (let col = -1; col < 3; col++) {
            let x = col * 32 + xOff;
            gCtx.fillStyle = '#6a6a6a'; gCtx.fillRect(x + 1, y + 1, 30, 14);
            gCtx.fillStyle = '#9a9a9a'; gCtx.fillRect(x + 1, y + 1, 30, 2); gCtx.fillRect(x + 1, y + 1, 2, 14);
        }
    }
    phina.asset.AssetManager.set('image', 'gray_brick', grayCanvas);

    GameApp({
        width: SCREEN_W, height: SCREEN_H, startLabel: 'init',
        assets: ASSETS,
        scenes: [
            { className: 'InitScene', label: 'init', nextLabel: 'title' },
            { className: 'TitleScene', label: 'title', nextLabel: 'main' },
            { className: 'MainScene', label: 'main', nextLabel: 'result' },
            { className: 'ResultScene', label: 'result', nextLabel: 'title' }
        ]
    }).run();
});

/**
 * 半角全角変換
 * @param {*} hankaku 
 * @param {*} digit 
 */
function toZenkaku(hankaku, digit) {
    let tmpStr = hankaku.toString(10).replace(/[A-Za-z0-9]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) + 65248);
    });
    if (tmpStr.length < digit) {
        for (let ii = tmpStr.length; ii < digit; ii++) {
            tmpStr = "　" + tmpStr;
        }
    }
    return tmpStr;
}