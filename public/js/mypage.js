(() => {
  const page = document.querySelector('#myPage');
  const message = document.querySelector('#myPageMessage');
  const loading = document.querySelector('#myPageLoading');
  const form = document.querySelector('#accountChangeForm');
  const save = document.querySelector('#saveAccountButton');
  const withdrawButton=document.querySelector('#withdrawAccountButton');let withdrawing=false,withdrawDialog=null;
  const membersTab = document.querySelector('#membersTab');
  const memberList = document.querySelector('#memberList');
  const memberSearch = document.querySelector('#memberSearch');
  let identity = null, version = 0, request = 0, memberRequest = 0, view = 'profile', members = [], saving = false, account = null;
  const isAdmin = () => window.portfolioAuth.user?.kind === 'admin';
  const date = value => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(value));
  const dateTime = value => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', timeZone: 'Asia/Seoul' }).format(new Date(value));
  function status(text, error = false) { message.textContent = text; message.hidden = !text; message.classList.toggle('notice-status-error', error); }
  async function read(response, epoch) {
    let data; try { data = await response.json(); } catch { throw Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
    if (epoch !== version) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '요청을 처리하지 못했습니다.');
    return data;
  }
  function info(root, entries) {
    root.replaceChildren(); entries.forEach(([label, value]) => {
      const term = document.createElement('dt'); term.textContent = label;
      const description = document.createElement('dd'); description.textContent = value; root.append(term, description);
    });
  }
  function renderAccount(data, resetForm = true) {
    account = data; const user = data.user;withdrawButton.disabled=withdrawing;
    info(document.querySelector('#profileInfo'), [['아이디', user.username], ['계정 유형', user.kind === 'admin' ? '관리자' : '일반 회원'], ['가입일', date(user.createdAt)], ['오늘의 뉴스 작성', user.canWriteNews ? '작성 가능' : '작성 권한 없음']]);
    info(document.querySelector('#accountInfo'), [['아이디', user.username], ['비밀번호', user.kind === 'admin' ? '관리자 로그인 설정 사용' : '암호화하여 보관 중']]);
    document.querySelector('.account-security-note').textContent = user.kind === 'admin' ? '관리자는 기존 서버 설정의 관리자 비밀번호로 로그인합니다. 비밀번호는 화면에 표시하지 않습니다.' : '비밀번호는 암호화하여 보관하므로 표시하지 않습니다. 현재 비밀번호를 확인한 뒤 새 비밀번호로 변경할 수 있습니다.';
    form.hidden = user.kind !== 'member';
    const quota = document.querySelector('#accountQuota');
    if (data.changes) {
      quota.textContent = '변경 가능 ' + data.changes.remaining + ' / 2회 · 다음 초기화: ' + dateTime(data.changes.resetsAt) + ' (한국 시간)';
      save.disabled = saving || data.changes.remaining === 0;
    } else quota.textContent = '관리자 계정은 기존 관리자 비밀번호로 접속합니다. 이 화면의 아이디·비밀번호 변경은 일반 회원 계정에 적용됩니다.';
    if (resetForm) { form.reset(); document.querySelector('#accountUsername').value = user.username; }
  }
  function showView(next) {
    view = ['profile', 'account', 'members', 'resume'].includes(next) ? next : 'profile';
    if (view === 'members' && !isAdmin()) view = 'profile';
    document.querySelectorAll('[data-my-panel]').forEach(node => { node.hidden = node.dataset.myPanel !== view; });
    document.querySelectorAll('[data-my-view]').forEach(node => { const active = node.dataset.myView === view; node.classList.toggle('active', active); node.setAttribute('aria-pressed', String(active)); });
  }
  async function loadAccount() {
    const epoch = version, sequence = ++request; loading.hidden = false;
    try {
      const data = await read(await window.portfolioAuth.fetch('/api/account'), epoch);
      if (epoch !== version || sequence !== request || page.hidden) return;
      renderAccount(data);
    } catch (error) { if (epoch === version && sequence === request) status(error.message, true); }
    finally { if (epoch === version && sequence === request) loading.hidden = true; }
  }
  function renderMembers() {
    memberList.replaceChildren();
    const term = memberSearch.value.trim().toLowerCase();
    const visible = members.filter(user => user.username.toLowerCase().includes(term));
    document.querySelector('#memberCount').textContent = '가입한 회원 ' + members.length + '명';
    document.querySelector('#memberEmpty').hidden = visible.length > 0;
    visible.forEach(user => {
      const row = document.createElement('li'); row.className = 'member-row';
      const details = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = user.username;
      const meta = document.createElement('span'); meta.className = 'member-meta'; meta.textContent = '가입일 ' + date(user.createdAt);
      const badge = document.createElement('span'); badge.className = 'member-permission' + (user.canWriteNews ? ' granted' : ''); badge.textContent = user.canWriteNews ? '뉴스 작성 가능' : '뉴스 읽기만 가능';
      details.append(name, meta, badge);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'member-permission-button';
      button.textContent = user.canWriteNews ? '작성 권한 해제' : '작성 권한 부여';
      button.setAttribute('aria-label', user.username + ' 뉴스 ' + button.textContent);
      button.addEventListener('click', async () => {
        const epoch = version; button.disabled = true; status('');
        try {
          const data = await read(await window.portfolioAuth.fetch('/api/admin/users/' + encodeURIComponent(user.id) + '/news-permission', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canWriteNews: !user.canWriteNews }) }), epoch);
          if (epoch !== version) return;
          const position = members.findIndex(item => item.id === user.id); if (position >= 0) members[position] = data.user;
          renderMembers(); status(data.user.username + ' 회원의 뉴스 작성 권한을 ' + (data.user.canWriteNews ? '부여했습니다.' : '해제했습니다.'));
        } catch (error) { if (epoch === version) status(error.message, true); }
        finally { button.disabled = false; }
      });
      row.append(details, button); memberList.append(row);
    });
  }
  async function loadMembers() {
    if (!isAdmin()) return;
    const epoch = version, sequence = ++memberRequest;
    const button = document.querySelector('#refreshMembersButton'); button.disabled = true;
    try {
      const data = await read(await window.portfolioAuth.fetch('/api/admin/users'), epoch);
      if (epoch !== version || sequence !== memberRequest || page.hidden) return;
      members = data.users; renderMembers();
    } catch (error) { if (epoch === version && sequence === memberRequest) status(error.message, true); }
    finally { if (epoch === version && sequence === memberRequest) button.disabled = false; }
  }
  function setVisible(visible, panel = 'profile') {
    page.hidden = !visible || !window.portfolioAuth.user;
    document.dispatchEvent(new CustomEvent('portfolio:mypage-view', { detail: { visible: !page.hidden && panel === 'resume' } }));
    if (page.hidden) { request++; memberRequest++; loading.hidden = true; return; }
    showView(panel); loadAccount(); if (view === 'members') loadMembers();
  }
  function syncUser(user) {
    membersTab.hidden = user?.kind !== 'admin';
    const next = user ? user.id + ':' + user.kind + ':' + user.username : null;
    if (next === identity) {
      if (account && user) { account.user.canWriteNews = user.canWriteNews; renderAccount(account, false); }
      return;
    }
    withdrawDialog?.close();withdrawDialog?.remove();withdrawDialog=null;withdrawing=false;withdrawButton.disabled=true;
    identity = next; version++; request++; memberRequest++; saving = false; account = null;
    members = []; memberList.replaceChildren(); memberSearch.value = ''; form.reset(); status('');
    document.querySelector('#profileInfo').replaceChildren(); document.querySelector('#accountInfo').replaceChildren();
    document.querySelector('#accountQuota').textContent = ''; form.hidden = true; loading.hidden = true;
    save.disabled = false; save.textContent = '계정 정보 변경'; document.querySelector('#refreshMembersButton').disabled = false;
    if (!user) page.hidden = true;
    else if (location.hash === '#mypage' || location.hash.startsWith('#mypage/')) setVisible(true, location.hash.split('/')[1] || 'profile');
  }
  withdrawButton.addEventListener('click',()=>{
    if(withdrawing||!account||!window.portfolioAuth.user||withdrawDialog)return;
    const epoch=version,owner=window.portfolioAuth.user.id,dialog=document.createElement('dialog');withdrawDialog=dialog;dialog.className='withdraw-account-dialog';
    const heading=document.createElement('h2');heading.id='withdrawAccountHeading';heading.textContent='정말로 회원을 탈퇴하시겠습니까?';dialog.setAttribute('aria-labelledby',heading.id);
    const warning=document.createElement('p');warning.textContent='본인의 계정, 모든 게시글과 첨부파일, 휴지통, 이력서·회사 PDF 양식, 포트폴리오와 공유 링크를 영구 삭제합니다. 다른 회원의 계정과 자료는 삭제하지 않습니다. 삭제한 자료는 복원할 수 없습니다.'+(window.portfolioAuth.user.kind==='admin'?' 관리자 탈퇴 후 관리자 로그인도 중지됩니다.':'');
    const notice=document.createElement('p');notice.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='withdraw-account-actions';const yes=document.createElement('button'),no=document.createElement('button');yes.type=no.type='button';yes.textContent='예';no.textContent='아니오';yes.className='withdraw-account-button';no.className='career-secondary';
    function close(){if(withdrawing)return;dialog.close();dialog.remove();if(withdrawDialog===dialog)withdrawDialog=null;}
    no.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    yes.addEventListener('click',async()=>{
      if(withdrawing||epoch!==version||owner!==window.portfolioAuth.user?.id)return;
      withdrawing=true;yes.disabled=no.disabled=withdrawButton.disabled=true;notice.textContent='본인 계정과 자료를 삭제하는 중…';
      try{
        const data=await read(await window.portfolioAuth.fetch('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true})}),epoch);
        if(epoch!==version||owner!==window.portfolioAuth.user?.id)return;
        window.portfolioAuth.withdrawn(data.message);
      }catch(error){if(epoch===version){notice.textContent=error.message;withdrawing=false;yes.disabled=no.disabled=false;withdrawButton.disabled=false;}}
    });
    actions.append(no,yes);dialog.append(heading,warning,notice,actions);document.body.append(dialog);dialog.showModal();no.focus();
  });
  window.addEventListener('hashchange',()=>{if(!withdrawing&&location.hash!=='#mypage/profile'&&location.hash!=='#mypage'){withdrawDialog?.close();withdrawDialog?.remove();withdrawDialog=null;}});
  window.portfolioMyPage = { setVisible };
  setInterval(() => {
    if (!page.hidden && account?.changes && Date.now() >= new Date(account.changes.resetsAt).getTime() && loading.hidden) loadAccount();
  }, 30000);
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => syncUser(window.portfolioAuth.user));
  document.querySelectorAll('[data-my-view]').forEach(button => button.addEventListener('click', () => { location.hash = 'mypage/' + button.dataset.myView; status(''); }));
  memberSearch.addEventListener('input', renderMembers);
  document.querySelector('#refreshMembersButton').addEventListener('click', () => { status(''); loadMembers(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || window.portfolioAuth.user?.kind !== 'member' || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.passwordConfirm) { status('새 비밀번호 확인이 일치하지 않습니다.', true); return; }
    const epoch = version; saving = true; save.disabled = true; save.textContent = '변경 중…'; status('');
    try {
      const data = await read(await window.portfolioAuth.fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }), epoch);
      if (epoch !== version) return;
      saving = false;
      window.portfolioAuth.acceptAccount(data.user);
      renderAccount(data); status('계정 정보가 변경되었습니다. 남은 변경 횟수는 ' + data.changes.remaining + '회입니다.');
    } catch (error) { if (epoch === version) status(error.message, true); }
    finally {
      if (epoch === version) { saving = false; save.disabled = account?.changes?.remaining === 0; save.textContent = '계정 정보 변경'; }
    }
  });
})();
