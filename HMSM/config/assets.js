const FONT_FAMILY = "'misaki_gothic','Meiryo',sans-serif";
const ASSETS = {
    font: {
        misaki_gothic: "https://cdn.leafscape.be/misaki/misaki_gothic_web.woff2"
    },
    image: {
        'playerImage': 'https://iwasaku.github.io/test/UvU/resource/angus_128.png',
        'obstacle_sheet': 'resource/images/obstacle_sheet.png',
        'heal_item_sheet': 'resource/images/heal_item_sheet.png',

        // 通常敵画像
        'enemy_ptn_0': 'resource/images/enemy_ptn_0.png',
        'enemy_etc_0': 'resource/images/enemy_etc_0.png',
        'enemy_ll_0': 'resource/images/enemy_ll_0.png',
        'enemy_blk_0': 'resource/images/enemy_blk_0.png',
        'enemy_spn_0': 'resource/images/enemy_spn_0.png',

        'enemy_ptn_1': 'resource/images/enemy_ptn_1.png',
        'enemy_etc_1': 'resource/images/enemy_etc_1.png',
        'enemy_ll_1': 'resource/images/enemy_ll_1.png',
        'enemy_blk_1': 'resource/images/enemy_blk_1.png',
        'enemy_spn_1': 'resource/images/enemy_spn_1.png',

        'enemy_ptn_2': 'resource/images/enemy_ptn_2.png',
        'enemy_etc_2': 'resource/images/enemy_etc_2.png',
        'enemy_ll_2': 'resource/images/enemy_ll_2.png',
        'enemy_blk_2': 'resource/images/enemy_blk_2.png',
        'enemy_spn_2': 'resource/images/enemy_spn_2.png',

        'enemy_ptn_3': 'resource/images/enemy_ptn_3.png',
        'enemy_etc_3': 'resource/images/enemy_etc_3.png',
        'enemy_ll_3': 'resource/images/enemy_ll_3.png',
        'enemy_blk_3': 'resource/images/enemy_blk_3.png',
        'enemy_spn_3': 'resource/images/enemy_spn_3.png',

        'enemy_ptn_4': 'resource/images/enemy_ptn_4.png',
        'enemy_etc_4': 'resource/images/enemy_etc_4.png',
        'enemy_ll_4': 'resource/images/enemy_ll_4.png',
        'enemy_blk_4': 'resource/images/enemy_blk_4.png',
        'enemy_spn_4': 'resource/images/enemy_spn_4.png',

        // ボス画像
        'boss_gohan': 'https://iwasaku.github.io/test4/KMT/resource/gohan.png',
        'boss_glutton': 'https://iwasaku.github.io/test4/KMT/resource/glutton.png',
        'boss_small': 'https://iwasaku.github.io/test4/KMT/resource/small.png',
        'boss_ika': 'https://iwasaku.github.io/test4/KMT/resource/ika.png',
        'boss_assassin': 'https://iwasaku.github.io/test4/KMT/resource/assassin.png',
        'boss_perfect': 'https://iwasaku.github.io/test4/KMT/resource/perfect.png',
        'boss_baby': 'https://iwasaku.github.io/test4/KMT/resource/baby.png',
        'boss_girl': 'https://iwasaku.github.io/test4/KMT/resource/girl.png',
        'boss_ninja': 'https://iwasaku.github.io/test4/KMT/resource/ninja.png',
        'boss_last': 'https://iwasaku.github.io/test4/KMT/resource/last.png',

        // ゲームオーバー
        'game_over': 'https://iwasaku.github.io/test4/KMT/resource/rip.png',
        'game_clear': 'https://iwasaku.github.io/test4/KMT/resource/maria.png',

        // 爆発
        "explosion": "https://iwasaku.github.io/test15/HGYG/resource/expl_48.png",
    },
    spritesheet: {
        "explosion_ss":
        {
            // フレーム情報
            "frame": {
                "width": 48, // 1フレームの画像サイズ（横）
                "height": 48, // 1フレームの画像サイズ（縦）
                "cols": 11, // フレーム数（横）
                "rows": 1, // フレーム数（縦）
            },
            // アニメーション情報
            "animations": {
                "start": { // アニメーション名
                    "frames": Array.range(11), // フレーム番号範囲[0,1,2]の形式でもOK
                    "next": "", // 次のアニメーション。空文字列なら終了。同じアニメーション名ならループ
                    "frequency": 1, // アニメーション間隔
                },
            }
        },
    },
    sound: {
        'reflect': 'resource/se/reflect.mp3',
        'explosion': 'https://iwasaku.github.io/test8/COKS/resource/explosion_1.mp3',
        'defeat_enemy': 'https://iwasaku.github.io/test8/COKS/resource/explosion_0.mp3',
        'defeat_boss': 'https://iwasaku.github.io/test8/COKS/resource/explosion_2.mp3',
        'hit': 'resource/se/hit.mp3',
        'get': 'https://iwasaku.github.io/test7/NEMLESSSTER/resource/coin05.mp3',
        'damage': 'resource/se/damage.mp3',
        'launch': 'resource/se/launch.mp3',
        'enemy_shot': 'resource/se/shot.mp3',
        'laser': 'resource/se/laser.mp3',
        'summon': 'resource/se/summon.mp3',
        'area_explode': 'resource/se/area_explode.mp3'
    }
};
