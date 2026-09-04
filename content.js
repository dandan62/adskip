(() => {
  'use strict';

  // スキップボタン候補のセレクタ（YouTube の DOM 変更に備えて複数保持）
  // ボタンそのものは押さないが、「スキップ可能になった合図」として検知に使う
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.videoAdUiSkipButton',
    '[id^="skip-button"] button',
    '.ytp-skip-ad button',
    '[id^="skip-ad"] button',
  ];

  const MIN_DELAY_MS = 500;
  const MAX_DELAY_MS = 1000;

  const LOG = '[AdSkip]';

  // live_chat などプレイヤーのないフレームでは何もしない
  if (!location.pathname.startsWith('/watch') &&
      !location.pathname.startsWith('/shorts') &&
      location.pathname !== '/') {
    return;
  }

  let enabled = true;
  // 同じボタンに対して何度もスキップを予約しないための管理
  const pending = new WeakSet();

  const randomDelay = () =>
    MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);

  const isVisible = (el) => {
    if (!el || !el.isConnected || el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' &&
      parseFloat(style.opacity || '1') > 0.1;
  };

  // ボタンはフェードインしながら現れる。完全に表示されて操作を受け付ける状態に
  // なって初めて「スキップ可能」とみなす
  const isReady = (el) => {
    if (!isVisible(el)) return false;
    const style = getComputedStyle(el);
    return parseFloat(style.opacity || '1') >= 0.9 && style.pointerEvents !== 'none';
  };

  const findSkipButton = () => {
    for (const selector of SKIP_SELECTORS) {
      for (const btn of document.querySelectorAll(selector)) {
        if (isReady(btn)) return btn;
      }
    }
    return null;
  };

  const isAdShowing = () => {
    const player = document.querySelector('#movie_player');
    return !!player && player.classList.contains('ad-showing');
  };

  // ページ内には空の video 要素が複数存在しうるため、実際に再生中のものを選ぶ
  const getActiveVideo = () => {
    const videos = [...document.querySelectorAll('video')];
    const loaded = videos.filter((v) => v.readyState > 0 || v.currentTime > 0);
    // 本編プレイヤーの video を最優先し、なければ再生位置が進んでいるものを使う
    return loaded.find((v) => v.classList.contains('html5-main-video')) ||
      loaded.sort((a, b) => b.currentTime - a.currentTime)[0] ||
      null;
  };

  const describeVideos = () =>
    [...document.querySelectorAll('video')].map((v, i) =>
      `#${i} class=${v.className || '(なし)'} readyState=${v.readyState} ` +
      `duration=${v.duration} currentTime=${v.currentTime.toFixed(1)}`);

  // 広告動画の再生位置を末尾に飛ばす。スキップボタンを押した場合と同じ結果になる
  const seekAdToEnd = () => {
    if (!isAdShowing()) {
      console.debug(`${LOG} シーク不可: 広告再生中ではありません`);
      return false;
    }
    const video = getActiveVideo();
    if (!video) {
      console.debug(`${LOG} シーク待機: 再生中のvideo要素が見つかりません`, describeVideos());
      return false;
    }
    if (!isFinite(video.duration) || video.duration <= 0) {
      console.debug(
        `${LOG} シーク待機: duration=${video.duration} currentTime=${video.currentTime}`,
        describeVideos());
      return false;
    }
    video.currentTime = Math.max(video.duration - 0.1, 0);
    video.play?.().catch(() => {});
    console.log(`${LOG} 広告をスキップしました (duration=${video.duration.toFixed(1)}s)`);
    return true;
  };

  // 広告のメディアがまだ読み込まれていない（readyState=0）ことがあるため、
  // 読み込まれるまで一定回数リトライしてからシークする
  let seekRetryTimer = null;
  const seekWhenReady = (attempt = 0) => {
    const MAX_ATTEMPTS = 12; // 500ms x 12 = 最大6秒待つ
    if (seekRetryTimer) return;
    if (seekAdToEnd()) return;
    if (!isAdShowing()) return;

    if (attempt >= MAX_ATTEMPTS) {
      console.log(`${LOG} 広告のメディアが読み込まれずスキップできませんでした`);
      return;
    }
    seekRetryTimer = setTimeout(() => {
      seekRetryTimer = null;
      seekWhenReady(attempt + 1);
    }, 500);
  };

  // スキップボタンの出現＝YouTube が「この広告はスキップして良い」と認めた合図。
  // そこから人間がボタンを押すまでの間を模した遅延を置いてスキップする
  const scheduleSkip = (btn) => {
    if (pending.has(btn)) return;
    pending.add(btn);

    const delay = randomDelay();
    console.log(`${LOG} スキップ可能になりました。${Math.round(delay)}ms 後にスキップします`);

    setTimeout(() => {
      if (!enabled || !isAdShowing()) {
        console.debug(`${LOG} 広告が終了していたためスキップを中止`);
        return;
      }
      seekWhenReady();
    }, delay);
  };

  // #movie_player に .ad-showing が付いている間が広告再生中
  let wasAdShowing = false;
  const checkAdState = () => {
    const adShowing = isAdShowing();
    if (adShowing === wasAdShowing) return;
    wasAdShowing = adShowing;
    console.log(`${LOG} ${adShowing ? '広告の再生を検知しました' : '広告が終了しました'}`);
  };

  const scan = () => {
    if (!enabled) return;
    checkAdState();
    const btn = findSkipButton();
    if (btn) scheduleSkip(btn);
  };

  // DOM 変化を監視（ボタン出現を即座に検知）
  const observer = new MutationObserver(() => scan());
  const startObserving = () => {
    const target = document.body || document.documentElement;
    if (!target) return;
    observer.observe(target, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled'],
    });
  };

  if (document.body) startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving, { once: true });

  // 監視漏れの保険として定期スキャン
  setInterval(scan, 500);
  scan();
  console.log(`${LOG} v${chrome.runtime.getManifest().version} 起動しました (${location.href})`);

  // ポップアップの ON/OFF 設定を反映
  chrome.storage?.sync.get({ enabled: true }, (v) => {
    enabled = v.enabled !== false;
  });
  chrome.storage?.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled) enabled = changes.enabled.newValue !== false;
  });
})();
