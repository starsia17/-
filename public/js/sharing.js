(() => {
  const modal = document.createElement('dialog'); modal.className = 'share-dialog';
  modal.innerHTML = '<div class="share-dialog-heading"><h2>공유하기</h2><button type="button" data-close aria-label="공유 창 닫기">×</button></div><p>공유 링크를 가진 사람은 로그인 없이 이 항목과 포함된 첨부 자료를 볼 수 있습니다. 원본을 수정하면 공유 화면에도 반영됩니다.</p><label class="share-consent"><input type="checkbox" data-consent>이 항목을 링크로 공개하는 데 동의합니다.</label><button type="button" data-create>공유 링크 만들기</button><div data-active hidden><label>공유 주소<input data-url readonly aria-label="공유 주소"></label><div class="share-dialog-actions"><button type="button" data-copy>링크 복사</button><button type="button" data-native>공유 앱 선택</button><button type="button" data-revoke>공유 중지</button></div></div><p data-status role="status"></p>';
  document.body.append(modal);
  const previewButton = document.createElement('button'); previewButton.type = 'button'; previewButton.textContent = '공유 화면 미리보기'; previewButton.className = 'career-secondary';
  const previewRoot = document.createElement('div'); previewRoot.className = 'career-share-preview'; previewRoot.hidden = true;
  modal.querySelector('.share-consent').before(previewButton); modal.append(previewRoot);
  const trashNote = document.createElement('p'); trashNote.textContent = '공유 중지 또는 휴지통 이동 시 링크가 해제됩니다. 복원 후 공유하려면 새 링크를 만들어주세요.';
  modal.querySelector('[data-active]').after(trashNote);
  const status = modal.querySelector('[data-status]'), active = modal.querySelector('[data-active]'), input = modal.querySelector('[data-url]');
  const consent = modal.querySelector('[data-consent]'), create = modal.querySelector('[data-create]'), revoke = modal.querySelector('[data-revoke]');
  let context = null, version = 0, busy = false, identity = null;
  function clearPreview() { previewRoot.querySelectorAll('video').forEach(video => video.pause()); previewRoot.replaceChildren(); previewRoot.hidden = true; modal.classList.remove('share-preview-open'); }
  previewButton.addEventListener('click', async () => {
    if (!context || busy) return; const epoch = version, current = { ...context }; previewButton.disabled = true;
    try { const response = await window.portfolioAuth.fetch('/api/' + (current.type === 'post' ? 'posts' : 'portfolios') + '/' + current.id + '/preview'); const data = await response.json();
      if (epoch !== version) return; if (!response.ok || !data.success) throw Error(data.message || '미리보기를 불러오지 못했습니다.');
      clearPreview(); previewRoot.hidden = false; modal.classList.add('share-preview-open'); previewRoot.append(window.portfolioPresentation.render(data, window.portfolioAuth.mediaUrl));
      status.textContent = '미리보기입니다. 공개 링크는 생성되지 않았습니다.';
    } catch (error) { if (epoch === version) status.textContent = error.message; }
    finally { previewButton.disabled = false; }
  });
  function show(token) {
    active.hidden = !token; create.hidden = !!token; consent.parentElement.hidden = !!token;
    input.value = token ? location.origin + '/share.html#' + token : '';
    modal.querySelector('[data-native]').hidden = !navigator.share;
  }
  function setBusy(value) { busy = value; create.disabled = value; revoke.disabled = value; consent.disabled = value; }
  async function request(method, epoch) {
    const response = await window.portfolioAuth.fetch('/api/shares/' + context.type + '/' + context.id, { method });
    const data = await response.json(); if (epoch !== version) throw Error('공유 창이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '공유 요청을 처리하지 못했습니다.'); return data;
  }
  window.portfolioShareButton = (type, id) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'share-item-button'; button.textContent = '공유하기';
    button.addEventListener('click', async () => {
      const epoch = ++version; clearPreview(); context = { type, id }; consent.checked = false; show(null); status.textContent = '공유 상태 확인 중…'; setBusy(true); modal.showModal();
      try { const data = await request('GET', epoch); if (epoch === version) { show(data.token); status.textContent = data.token ? '현재 공유 중입니다.' : '공유하지 않은 항목입니다.'; } }
      catch (error) { if (epoch === version) status.textContent = error.message; }
      finally { if (epoch === version) setBusy(false); }
    }); return button;
  };
  create.addEventListener('click', async () => {
    if (busy) return; if (!consent.checked) { status.textContent = '공개 범위를 확인하고 동의에 체크해주세요.'; return; }
    const epoch = version; setBusy(true);
    try { const data = await request('POST', epoch); if (epoch === version) { show(data.token); status.textContent = '공유 링크가 생성되었습니다.'; } }
    catch (error) { if (epoch === version) status.textContent = error.message; }
    finally { if (epoch === version) setBusy(false); }
  });
  revoke.addEventListener('click', async () => {
    if (busy) return; const epoch = version; setBusy(true);
    try { await request('DELETE', epoch); if (epoch === version) { show(null); consent.checked = false; status.textContent = '공유를 중지했습니다. 기존 링크로는 열 수 없습니다.'; } }
    catch (error) { if (epoch === version) status.textContent = error.message; }
    finally { if (epoch === version) setBusy(false); }
  });
  modal.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(input.value); status.textContent = '공유 주소를 복사했습니다.'; }
    catch { input.focus(); input.select(); status.textContent = '주소를 선택했습니다. 복사 메뉴를 이용해주세요.'; }
  });
  modal.querySelector('[data-native]').addEventListener('click', async () => {
    try { await navigator.share({ title: '작업 포트폴리오', url: input.value }); } catch (error) { if (error.name !== 'AbortError') status.textContent = '링크 복사를 이용해주세요.'; }
  });
  modal.querySelector('[data-close]').addEventListener('click', () => modal.close());
  modal.addEventListener('close', () => { version++; context = null; input.value = ''; clearPreview(); });
  document.addEventListener('portfolio:auth', event => {
    const next = event.detail.user?.id || null; if (next === identity) return;
    identity = next; version++; if (modal.open) modal.close();
  });
})();
