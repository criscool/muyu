const STORAGE_MERIT_KEY = 'muyu_merit_v1';
const STORAGE_SETTINGS_KEY = 'muyu_settings_v3';

const MAX_FLOAT_COUNT = 10;
const AUDIO_POOL_SIZE = 4;
const MUYU_CYCLE_TARGET = 30;
const BEAD_COUNT = 16;
const BEAD_STEP_DEG = 360 / BEAD_COUNT;

const MODE_MUYU = 'muyu';
const MODE_BEADS = 'beads';
const MODE_BELL = 'bell';

const MODE_META = {
  [MODE_MUYU]: {
    title: '功德木鱼',
    image: '/assets/images/muyu-main.svg',
    soundLabel: '木鱼音效'
  },
  [MODE_BEADS]: {
    title: '静心念珠',
    image: '/assets/images/beads-oval-main.svg',
    soundLabel: '念珠音效'
  },
  [MODE_BELL]: {
    title: '清心撞钟',
    image: '/assets/images/bell-main.svg',
    soundLabel: '钟声音效'
  }
};

const DEFAULT_SETTINGS = {
  soundOn: true,
  vibrateOn: true,
  showFloat: true,
  increment: 1,
  soundMap: {
    muyu: 'wood1',
    beads: 'beads1',
    bell: 'bell1'
  }
};

const INCREMENT_OPTIONS = [
  { label: '+1', value: 1 },
  { label: '+3', value: 3 },
  { label: '+9', value: 9 }
];

const SOUND_LIBRARY = {
  [MODE_MUYU]: [
    { key: 'wood1', name: '清木', src: '/assets/audio/wood-hit-1.wav' },
    { key: 'wood2', name: '厚木', src: '/assets/audio/wood-hit-2.wav' },
    { key: 'wood3', name: '空灵', src: '/assets/audio/wood-hit-3.wav' }
  ],
  [MODE_BEADS]: [
    { key: 'beads1', name: '轻珠', src: '/assets/audio/beads-hit-1.wav' },
    { key: 'beads2', name: '沉珠', src: '/assets/audio/beads-hit-2.wav' }
  ],
  [MODE_BELL]: [
    { key: 'bell1', name: '寺钟', src: '/assets/audio/bell-hit-1.wav' },
    { key: 'bell2', name: '铜钟', src: '/assets/audio/bell-hit-2.wav' }
  ]
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function computeMuyuScale(cycleCount) {
  const base = 0.34;
  const p = clamp(cycleCount, 0, MUYU_CYCLE_TARGET) / MUYU_CYCLE_TARGET;
  const growth = Math.pow(p, 0.82);
  return Number(clamp(base + growth * 1.26, 0.34, 1.86).toFixed(3));
}

function computeCommonScale(merit) {
  const base = 0.52;
  const growth = 1 - Math.exp(-merit / 50);
  return Number(clamp(base + growth * 0.9, 0.52, 1.72).toFixed(3));
}

function computeScale(mode, merit, muyuCycleCount) {
  if (mode === MODE_MUYU) return computeMuyuScale(muyuCycleCount);
  if (mode === MODE_BEADS) {
    const base = 0.8;
    const growth = 1 - Math.exp(-merit / 90);
    return Number(clamp(base + growth * 0.34, 0.8, 1.14).toFixed(3));
  }
  return computeCommonScale(merit);
}

function buildBeadsNodes(phaseDeg) {
  const nodes = [];
  const rx = 250;
  const ry = 184;
  for (let i = 0; i < BEAD_COUNT; i += 1) {
    const angleDeg = -90 + i * BEAD_STEP_DEG + phaseDeg;
    const rad = angleDeg * Math.PI / 180;
    const x = Math.cos(rad) * rx;
    const y = Math.sin(rad) * ry;
    nodes.push({
      id: `bead_${i}`,
      left: Number((310 + x - 32).toFixed(2)),
      top: Number((260 + y - 32).toFixed(2)),
      z: Math.round(1000 + y)
    });
  }
  return nodes;
}

Page({
  data: {
    mode: MODE_MUYU,
    modeMeta: MODE_META,
    merit: 0,
    muyuCycleCount: 0,
    targetScale: 0.34,
    isHitting: false,
    beadsPhase: 0,
    beadsNodes: buildBeadsNodes(0),
    showBuddhaRise: false,
    floatTexts: [],
    showSettings: false,
    settings: { ...DEFAULT_SETTINGS },
    incrementOptions: INCREMENT_OPTIONS,
    incrementIndex: 0,
    soundOptions: SOUND_LIBRARY[MODE_MUYU],
    soundIndex: 0
  },

  onLoad() {
    this.hitFeedbackTimer = null;
    this.floatGcTimer = null;
    this.audioPool = [];
    this.audioPointer = 0;
    this.floatId = 0;
    this.lastVibrateAt = 0;
    this.buddhaRiseTimer = null;
    this.buddhaResetTimer = null;
    this.isMuyuAscending = false;
    this.isDevtools = false;
    try {
      const info = wx.getSystemInfoSync();
      this.isDevtools = info && info.platform === 'devtools';
    } catch (err) {
    }

    const merit = Number(wx.getStorageSync(STORAGE_MERIT_KEY) || 0);
    const saved = wx.getStorageSync(STORAGE_SETTINGS_KEY) || {};
    const settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
      soundMap: {
        ...DEFAULT_SETTINGS.soundMap,
        ...(saved.soundMap || {})
      }
    };

    const mode = MODE_MUYU;
    const muyuCycleCount = merit % MUYU_CYCLE_TARGET;
    const soundOptions = this.getSoundOptions(mode);
    const activeSoundKey = this.getActiveSoundKey(settings, mode);

    this.setData({
      mode,
      merit,
      muyuCycleCount,
      targetScale: computeScale(mode, merit, muyuCycleCount),
      beadsPhase: 0,
      beadsNodes: buildBeadsNodes(0),
      settings,
      incrementIndex: this.findIncrementIndex(settings.increment),
      soundOptions,
      soundIndex: this.findSoundIndex(soundOptions, activeSoundKey)
    });

    this.initAudioPool(activeSoundKey, mode);
  },

  onUnload() {
    if (this.hitFeedbackTimer) clearTimeout(this.hitFeedbackTimer);
    if (this.floatGcTimer) clearTimeout(this.floatGcTimer);
    if (this.buddhaRiseTimer) clearTimeout(this.buddhaRiseTimer);
    if (this.buddhaResetTimer) clearTimeout(this.buddhaResetTimer);
    this.destroyAudioPool();
  },

  getSoundOptions(mode) {
    return SOUND_LIBRARY[mode] || SOUND_LIBRARY[MODE_MUYU];
  },

  getActiveSoundKey(settings, mode) {
    const options = this.getSoundOptions(mode);
    const fallbackKey = options[0].key;
    const picked = (settings.soundMap || {})[mode];
    return options.some((item) => item.key === picked) ? picked : fallbackKey;
  },

  getSoundByKey(mode, soundKey) {
    const options = this.getSoundOptions(mode);
    const found = options.find((item) => item.key === soundKey);
    return found || options[0];
  },

  findIncrementIndex(value) {
    const idx = INCREMENT_OPTIONS.findIndex((opt) => opt.value === value);
    return idx >= 0 ? idx : 0;
  },

  findSoundIndex(options, soundKey) {
    const idx = options.findIndex((opt) => opt.key === soundKey);
    return idx >= 0 ? idx : 0;
  },

  initAudioPool(soundKey, mode) {
    this.destroyAudioPool();
    const sound = this.getSoundByKey(mode, soundKey);
    for (let i = 0; i < AUDIO_POOL_SIZE; i += 1) {
      const audio = wx.createInnerAudioContext();
      audio.autoplay = false;
      audio.obeyMuteSwitch = true;
      audio.src = sound.src;
      this.audioPool.push(audio);
    }
    this.audioPointer = 0;
  },

  updateAudioSource(soundKey, mode) {
    const sound = this.getSoundByKey(mode, soundKey);
    this.audioPool.forEach((audio) => {
      audio.stop();
      audio.src = sound.src;
    });
    this.audioPointer = 0;
  },

  destroyAudioPool() {
    this.audioPool.forEach((audio) => {
      try {
        audio.stop();
        audio.destroy();
      } catch (err) {
      }
    });
    this.audioPool = [];
    this.audioPointer = 0;
  },

  persistMerit(merit) {
    wx.setStorageSync(STORAGE_MERIT_KEY, merit);
  },

  persistSettings(nextSettings) {
    wx.setStorageSync(STORAGE_SETTINGS_KEY, nextSettings);
  },

  onHitTarget() {
    if (this.data.mode === MODE_MUYU && this.isMuyuAscending) return;

    const increment = this.data.settings.increment;
    const nextMerit = this.data.merit + increment;
    const nextCycleCount = this.data.mode === MODE_MUYU
      ? this.data.muyuCycleCount + increment
      : this.data.muyuCycleCount;
    const reachedCycle = this.data.mode === MODE_MUYU && nextCycleCount >= MUYU_CYCLE_TARGET;

    this.setData({
      merit: nextMerit,
      muyuCycleCount: reachedCycle ? MUYU_CYCLE_TARGET : nextCycleCount,
      targetScale: computeScale(this.data.mode, nextMerit, reachedCycle ? MUYU_CYCLE_TARGET : nextCycleCount)
    });
    this.persistMerit(nextMerit);

    this.playHitSound();
    this.triggerHitFeedback();
    if (this.data.mode === MODE_BEADS) this.stepBeadsMotion();

    if (this.data.settings.vibrateOn) this.safeVibrate();
    if (this.data.settings.showFloat) this.spawnFloatText(increment);

    if (reachedCycle) {
      this.triggerBuddhaRise(nextMerit);
    }
  },

  playHitSound() {
    if (!this.data.settings.soundOn || !this.audioPool.length) return;
    const audio = this.audioPool[this.audioPointer];
    this.audioPointer = (this.audioPointer + 1) % this.audioPool.length;
    try {
      audio.stop();
      if (typeof audio.seek === 'function') audio.seek(0);
      audio.play();
    } catch (err) {
    }
  },

  safeVibrate() {
    if (this.isDevtools) return;
    const now = Date.now();
    if (now - this.lastVibrateAt < 60) return;
    this.lastVibrateAt = now;
    const canUseTyped = typeof wx.canIUse === 'function' && wx.canIUse('vibrateShort.object.type');
    try {
      if (canUseTyped) {
        wx.vibrateShort({ type: 'light', fail: () => {} });
      } else {
        wx.vibrateShort({ fail: () => {} });
      }
    } catch (err) {
    }
  },

  triggerHitFeedback() {
    if (this.hitFeedbackTimer) clearTimeout(this.hitFeedbackTimer);
    this.setData({ isHitting: true });
    this.hitFeedbackTimer = setTimeout(() => {
      this.setData({ isHitting: false });
    }, 130);
  },

  spawnFloatText(value) {
    const x = Math.floor(Math.random() * 70) - 35;
    const drift = Math.floor(Math.random() * 46) - 23;
    const next = this.data.floatTexts.concat({
      id: `${Date.now()}_${this.floatId}`,
      value,
      x,
      drift
    });
    this.floatId += 1;

    while (next.length > MAX_FLOAT_COUNT) next.shift();
    this.setData({ floatTexts: next });

    if (this.floatGcTimer) clearTimeout(this.floatGcTimer);
    this.floatGcTimer = setTimeout(() => {
      this.setData({ floatTexts: this.data.floatTexts.slice(1) });
    }, 680);
  },

  onSwitchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.mode) return;

    const soundOptions = this.getSoundOptions(mode);
    const activeSoundKey = this.getActiveSoundKey(this.data.settings, mode);
    this.setData({
      mode,
      soundOptions,
      soundIndex: this.findSoundIndex(soundOptions, activeSoundKey),
      targetScale: computeScale(mode, this.data.merit, this.data.muyuCycleCount),
      beadsPhase: mode === MODE_BEADS ? this.data.beadsPhase : 0,
      beadsNodes: mode === MODE_BEADS ? this.data.beadsNodes : buildBeadsNodes(0),
      showBuddhaRise: false
    });
    this.isMuyuAscending = false;
    if (this.buddhaRiseTimer) clearTimeout(this.buddhaRiseTimer);
    if (this.buddhaResetTimer) clearTimeout(this.buddhaResetTimer);
    this.updateAudioSource(activeSoundKey, mode);
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
  },

  onSwitchSound(e) {
    this.updateSettings({ soundOn: !!e.detail.value });
  },

  onSwitchVibrate(e) {
    this.updateSettings({ vibrateOn: !!e.detail.value });
  },

  onSwitchFloat(e) {
    this.updateSettings({ showFloat: !!e.detail.value });
  },

  onChangeIncrement(e) {
    const idx = Number(e.detail.value) || 0;
    const picked = INCREMENT_OPTIONS[idx] || INCREMENT_OPTIONS[0];
    this.setData({ incrementIndex: idx });
    this.updateSettings({ increment: picked.value });
  },

  onChangeSound(e) {
    const idx = Number(e.detail.value) || 0;
    const options = this.getSoundOptions(this.data.mode);
    const picked = options[idx] || options[0];
    this.setData({ soundIndex: idx });

    const soundMap = {
      ...(this.data.settings.soundMap || {}),
      [this.data.mode]: picked.key
    };
    this.updateSettings({ soundMap });
    this.updateAudioSource(picked.key, this.data.mode);
  },

  updateSettings(partial) {
    const settings = {
      ...this.data.settings,
      ...partial
    };
    this.setData({ settings });
    this.persistSettings(settings);
  },

  onResetMerit() {
    wx.showModal({
      title: '确认清零',
      content: '清零后无法恢复，确认继续吗？',
      confirmColor: '#c68a44',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({
          merit: 0,
          muyuCycleCount: 0,
          targetScale: computeScale(this.data.mode, 0, 0),
          beadsPhase: 0,
          beadsNodes: buildBeadsNodes(0),
          showBuddhaRise: false,
          floatTexts: []
        });
        this.isMuyuAscending = false;
        if (this.buddhaRiseTimer) clearTimeout(this.buddhaRiseTimer);
        if (this.buddhaResetTimer) clearTimeout(this.buddhaResetTimer);
        this.persistMerit(0);
        wx.showToast({ title: '已清零', icon: 'success' });
      }
    });
  },

  triggerBuddhaRise(nextMerit) {
    if (this.isMuyuAscending) return;
    this.isMuyuAscending = true;
    if (this.buddhaRiseTimer) clearTimeout(this.buddhaRiseTimer);
    if (this.buddhaResetTimer) clearTimeout(this.buddhaResetTimer);

    this.setData({ showBuddhaRise: false });
    this.buddhaRiseTimer = setTimeout(() => {
      this.setData({ showBuddhaRise: true });
    }, 20);

    this.buddhaResetTimer = setTimeout(() => {
      this.setData({
        showBuddhaRise: false,
        muyuCycleCount: 0,
        targetScale: computeScale(MODE_MUYU, nextMerit, 0)
      });
      this.isMuyuAscending = false;
    }, 1500);
  },

  stepBeadsMotion() {
    const nextPhase = (this.data.beadsPhase + BEAD_STEP_DEG) % 360;
    this.setData({
      beadsPhase: nextPhase,
      beadsNodes: buildBeadsNodes(nextPhase)
    });
  }
});
