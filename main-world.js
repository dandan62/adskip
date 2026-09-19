// 【実験】ページ側の JavaScript 世界（MAIN world）で動くスクリプト。
//
// JavaScript から作ったイベントは isTrusted が false になり、YouTube のスキップボタンは
// それを無視する。isTrusted はイベント自体には書き込めないが、YouTube の処理が受け取る
// オブジェクトは差し替えられる。そこで YouTube のスクリプトより先に addEventListener を
// 包み込み、この拡張機能が送ったクリックの時だけ「isTrusted を聞かれたら true と答える」
// 代理オブジェクト（Proxy）を渡す。
//
// 拡張機能側（content.js）とは JavaScript の世界が別なので、イベントに付けた目印は
// 向こうからは見えない。そのためクリックはこちらの世界から送り、連絡は DOM の属性と
// カスタムイベントで行う。
(() => {
  'use strict';

  const LOG = '[AdSkip:main]';
  // この拡張機能が送ったイベントに付ける目印。この世界の中でしか見えない
  const MARK = Symbol('adskip-synthetic');
  // content.js がクリック対象のボタンに付ける属性
  const TARGET_ATTR = 'data-adskip-target';

  // 目印付きイベントの時だけ、isTrusted を true と答える代理オブジェクトにする。
  // isTrusted はゲッターを持つアクセサプロパティなので、Proxy が別の値を返しても
  // Proxy の不変条件には違反しない
  const trusted = (event) => new Proxy(event, {
    get(target, key) {
      if (key === 'isTrusted') return true;
      const value = Reflect.get(target, key, target);
      // preventDefault などのメソッドは本物のイベントを this にして呼ぶ必要がある
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  let passedThrough = 0; // 目印付きイベントが YouTube の処理に届いた回数（診断用）

  // 元のリスナー → (type|capture → 包んだリスナー)。removeEventListener で正しく外すため
  const wrappers = new WeakMap();
  const keyOf = (type, options) =>
    `${type}|${typeof options === 'boolean' ? options : !!options?.capture}`;

  const wrap = (listener, key) => {
    let byKey = wrappers.get(listener);
    if (!byKey) wrappers.set(listener, (byKey = new Map()));
    if (byKey.has(key)) return byKey.get(key);

    const wrapped = function (event) {
      let ev = event;
      if (event && event[MARK]) {
        passedThrough++;
        ev = trusted(event);
      }
      return typeof listener === 'function'
        ? listener.call(this, ev)
        : listener.handleEvent(ev);
    };
    byKey.set(key, wrapped);
    return wrapped;
  };

  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (!listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function')) {
      return origAdd.call(this, type, listener, options);
    }
    return origAdd.call(this, type, wrap(listener, keyOf(type, options)), options);
  };

  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const wrapped = listener && wrappers.get(listener)?.get(keyOf(type, options));
    return origRemove.call(this, type, wrapped || listener, options);
  };

  // 実際のマウス操作に近いイベント列を、目印を付けて送る
  const send = (el, EventType, type, init) => {
    const ev = new EventType(type, init);
    ev[MARK] = true;
    el.dispatchEvent(ev);
  };

  const click = (el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
    };
    const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };

    send(el, PointerEvent, 'pointerover', pointer);
    send(el, MouseEvent, 'mouseover', base);
    send(el, PointerEvent, 'pointerenter', { ...pointer, bubbles: false });
    send(el, MouseEvent, 'mouseenter', { ...base, bubbles: false });
    send(el, PointerEvent, 'pointermove', pointer);
    send(el, MouseEvent, 'mousemove', base);
    send(el, PointerEvent, 'pointerdown', { ...pointer, button: 0, buttons: 1 });
    send(el, MouseEvent, 'mousedown', { ...base, button: 0, buttons: 1 });
    send(el, PointerEvent, 'pointerup', { ...pointer, button: 0, buttons: 0 });
    send(el, MouseEvent, 'mouseup', { ...base, button: 0, buttons: 0 });
    send(el, MouseEvent, 'click', { ...base, button: 0, buttons: 0, detail: 1 });
    // ホバー状態が残らないよう後始末する
    send(el, PointerEvent, 'pointerout', pointer);
    send(el, MouseEvent, 'mouseout', base);
    send(el, PointerEvent, 'pointerleave', { ...pointer, bubbles: false });
    send(el, MouseEvent, 'mouseleave', { ...base, bubbles: false });
  };

  // content.js からの依頼を受けてクリックする
  document.addEventListener('adskip:click', () => {
    const btn = document.querySelector(`[${TARGET_ATTR}]`);
    if (!btn) {
      console.log(`${LOG} クリック対象が見つかりません`);
      return;
    }
    btn.removeAttribute(TARGET_ATTR);

    const before = passedThrough;
    click(btn);
    console.log(
      `${LOG} クリックを送りました（YouTube の処理に届いたイベント: ${passedThrough - before} 件）`);
  });

  console.log(`${LOG} addEventListener を包み込みました`);
})();
