(() => {
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const blank = () => ({ name: '', role: '', email: '', phone: '', website: '', bodyHtml: '' });
  const projectTemplate = '<h2>프로젝트 개요</h2><p>작업 목표와 배경을 작성하세요.</p><h2>담당 역할 · 기여도</h2><p>팀 규모, 맡은 역할과 직접 수행한 작업을 작성하세요.</p><h2>기간 · 사용 도구</h2><p>작업 기간과 사용한 프로그램을 작성하세요.</p><h2>문제와 해결 과정</h2><p>문제 정의, 시도한 방법과 선택한 이유를 작성하세요.</p><h2>결과 · 성과</h2><p>최종 결과와 확인 가능한 수치 또는 피드백을 작성하세요.</p><h2>배운 점</h2><p>개선한 점과 다음 작업에 적용할 내용을 작성하세요.</p>';
  const resumeTemplate = '<h2>자기소개</h2><p>지원 직무와 나의 강점을 소개하세요.</p><h2>경력 · 활동</h2><p>기간, 소속, 담당 업무와 성과를 작성하세요.</p><h2>학력 · 교육</h2><p>전공과 직무 관련 교육을 작성하세요.</p><h2>기술 · 사용 도구</h2><p>사용 가능한 도구와 활용 경험을 작성하세요.</p><h2>수상 · 자격</h2><p>직무 관련 수상 및 자격 사항을 작성하세요.</p>';
  let epoch = 0, identity = null, profileRequest = 0;
  async function read(url, options, version = epoch) {
    const response = await window.portfolioAuth.fetch(url, options); let data;
    try { data = await response.json(); } catch { throw Error('서버 응답을 확인하지 못했습니다.'); }
    if (version !== epoch) throw Error('로그인 계정이 변경되었습니다.');
    if (response.status === 401) window.portfolioAuth.expire();
    if (!response.ok || !data.success) throw Error(data.message || '저장하지 못했습니다.'); return data;
  }
  function field(root, name, label, max, type = 'text') {
    const row = node('label', label), input = node('input'); input.name = name; input.type = type; input.maxLength = max;
    if (name === 'website') input.placeholder = 'https://…'; row.append(input); root.append(row); return input;
  }
  function editor(root, label) {
    const host = node('div'), target = node('div', undefined, 'rich-editor blog-article career-editor');
    target.contentEditable = 'true'; target.setAttribute('role', 'textbox'); target.setAttribute('aria-multiline', 'true'); target.setAttribute('aria-label', label);
    root.append(host, target); const tools = window.portfolioTextEditor.mount(host, target); return { target, tools };
  }
  function templateButton(root, label, edit, template) {
    const button = node('button', label, 'career-secondary'); button.type = 'button';
    button.addEventListener('click', () => {
      if (edit.target.innerText.trim() && !confirm('현재 작성한 글을 양식으로 바꿀까요? 기존 내용이 교체됩니다.')) return;
      edit.tools.reset(); edit.target.innerHTML = template; edit.target.dispatchEvent(new Event('input', { bubbles: true }));
    }); root.append(button); return button;
  }
  function resumeFields(root) {
    const fields = node('div', undefined, 'career-fields'), inputs = {};
    for (const [name, label, max, type] of [['name','이름',80,'text'],['role','직무 · 한 줄 소개',120,'text'],['email','이메일',254,'email'],['phone','연락처',60,'tel'],['website','개인 링크',2048,'url']]) inputs[name] = field(fields, name, label, max, type);
    root.append(fields); const edit = editor(root, '이력서 본문');
    const template = templateButton(root, '이력서 양식 넣기', edit, resumeTemplate);
    return { set(value = blank()) { Object.entries(inputs).forEach(([key, input]) => { input.value = value[key] || ''; }); edit.tools.reset(); edit.target.innerHTML = value.bodyHtml || ''; },
      get() { return { ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()])), bodyHtml: edit.tools.html() }; },
      busy(value) { Object.values(inputs).forEach(input => { input.disabled = value; }); template.disabled = value; edit.tools.setBusy(value); }, edit };
  }
  const form = document.querySelector('#portfolioBuilderForm'), intro = document.querySelector('#portfolioIntroEditor');
  let introTools, resumeTools, noteEditor, company, role, include, noteSelect, noteHelp, importButton, noteTemplate, extras, resumeSnapshot, notes = new Map(), selectedPosts = [], activeNote = '', builderReady = false, builderGeneration = 0;
  function saveNote() { if (activeNote && noteEditor) notes.set(activeNote, noteEditor.tools.html()); }
  function switchNote(id) {
    saveNote(); activeNote = id; noteEditor.tools.reset(); noteEditor.target.innerHTML = notes.get(id) || '';
    noteEditor.tools.setBusy(!id); noteTemplate.disabled = !id; noteHelp.textContent = id ? '이 설명은 이 포트폴리오에만 저장됩니다. 원본 게시글은 바뀌지 않습니다.' : '게시글을 선택하면 설명을 작성할 수 있어요.';
  }
  function initBuilder() {
    if (builderReady) return;
    introTools = window.portfolioTextEditor.mount(document.querySelector('#portfolioIntroToolbarHost'), intro);
    extras = node('section', undefined, 'career-builder-extras'); extras.append(node('h3', '4. 취업용 정보와 프로젝트 설명'));
    const target = node('div', undefined, 'career-fields'); company = field(target, 'targetCompany', '지원 회사 · 분류용', 100); role = field(target, 'targetRole', '지원 직무 · 분류용', 120);
    extras.append(target, node('p', '회사·직무 정보는 내 목록에서만 보이며 공유 화면과 PDF에는 표시하지 않습니다.', 'portfolio-note'));
    const resumeBox = node('details', undefined, 'career-disclosure'); resumeBox.append(node('summary', '이력서·프로필 구성'));
    const includeLabel = node('label', undefined, 'career-checkbox'); include = node('input'); include.type = 'checkbox'; includeLabel.append(include, document.createTextNode('이 포트폴리오에 이력서·연락처 포함')); resumeBox.append(includeLabel);
    const snapshot = resumeSnapshot = node('div'); importButton = node('button', '마이페이지 프로필 가져오기', 'career-secondary'); importButton.type = 'button'; snapshot.append(importButton);
    snapshot.append(node('p', '가져온 뒤에는 별도 복사본으로 저장됩니다. 공개할 연락처만 남겨주세요.', 'portfolio-note'));
    resumeTools = resumeFields(snapshot); resumeBox.append(snapshot); extras.append(resumeBox);
    include.addEventListener('change', () => { snapshot.hidden = !include.checked; resumeTools.busy(!include.checked); }); snapshot.hidden = true;
    importButton.addEventListener('click', async () => {
      const version = epoch, generation = builderGeneration; importButton.disabled = true; include.disabled = true; resumeTools.busy(true);
      try { const data = await read('/api/career-profile', undefined, version); if (!form.hidden && version === epoch && generation === builderGeneration) { resumeTools.set(data.profile); include.checked = true; snapshot.hidden = false; resumeTools.busy(false); noteHelp.textContent = '프로필을 가져왔습니다. 포트폴리오 저장 버튼을 눌러 적용하세요.'; } }
      catch (error) { if (version === epoch && generation === builderGeneration) noteHelp.textContent = error.message; }
      finally { if (version === epoch && generation === builderGeneration) { importButton.disabled = false; include.disabled = false; resumeTools.busy(!include.checked); } }
    });
    const description = node('details', undefined, 'career-disclosure'); description.open = true; description.append(node('summary', '프로젝트 설명 · 양식과 자유 편집'));
    const selectLabel = node('label', '설명할 작업 선택'); noteSelect = node('select'); noteSelect.setAttribute('aria-label', '설명할 작업 선택'); selectLabel.append(noteSelect); description.append(selectLabel);
    noteHelp = node('p', '', 'portfolio-note'); noteHelp.setAttribute('role','status'); description.append(noteHelp);
    noteEditor = editor(description, '프로젝트 설명'); noteTemplate = templateButton(description, '프로젝트 설명 양식 넣기', noteEditor, projectTemplate);
    noteSelect.addEventListener('change', () => switchNote(noteSelect.value)); extras.append(description); form.append(extras);
    const actions = form.querySelector('.portfolio-builder-actions'); actions.classList.add('career-builder-actions'); form.append(actions); builderReady = true;
  }
  function openBuilder(item) {
    initBuilder(); builderGeneration++; notes = new Map((item?.projectNotes || []).map(note => [note.postId, note.bodyHtml])); activeNote = ''; selectedPosts = [];
    introTools.reset(); if (item?.introductionHtml) intro.innerHTML = item.introductionHtml;
    else if (item?.introduction) intro.append(node('p', item.introduction));
    company.value = item?.targetCompany || ''; role.value = item?.targetRole || ''; include.checked = !!item?.resume; resumeTools.set(item?.resume || blank());
    resumeSnapshot.hidden = !include.checked;
    noteEditor.tools.reset(); busyBuilder(false);
  }
  function syncSelection(posts) {
    if (!builderReady) return;
    saveNote(); selectedPosts = posts; const prior = activeNote; noteSelect.replaceChildren();
    if (!posts.length) { const option = node('option', '먼저 게시글을 선택해주세요.'); option.value = ''; noteSelect.append(option); }
    posts.forEach(post => { const option = node('option', post.title); option.value = post._id; noteSelect.append(option); });
    const next = posts.some(post => post._id === prior) ? prior : posts[0]?._id || '';
    activeNote = ''; noteSelect.value = next; switchNote(next);
  }
  function builderValues() {
    saveNote(); const introductionHtml = introTools.html(); const projectNotes = selectedPosts.map(post => ({ postId: post._id, bodyHtml: notes.get(post._id) || '' })).filter(note => note.bodyHtml);
    const resume = include.checked ? resumeTools.get() : null;
    const htmls = [introductionHtml, ...projectNotes.map(note => note.bodyHtml), resume?.bodyHtml || ''];
    if (htmls.some(html => { const e = node('div'); e.innerHTML = html; return html.length > 150000 || e.textContent.length > 25000; })) throw Error('각 편집 영역은 최대 25,000자까지 작성할 수 있습니다.');
    if (introductionHtml.length + projectNotes.reduce((sum,note)=>sum+note.bodyHtml.length,0) + (resume?.bodyHtml.length || 0) > 600000) throw Error('포트폴리오 전체 편집 내용이 너무 큽니다. 작업 수를 나누어 저장해주세요.');
    return { introduction: intro.innerText.trim().slice(0,2000), introductionHtml, targetCompany: company.value.trim(), targetRole: role.value.trim(), resume, projectNotes };
  }
  function busyBuilder(value) { if (!builderReady) return; if (value) builderGeneration++; introTools.setBusy(value); resumeTools.busy(value || !include.checked); noteEditor.tools.setBusy(value || !activeNote); noteTemplate.disabled = value || !activeNote; importButton.disabled = value; }
  function leaveBuilder() { builderGeneration++; }
  // My page uses the same editor and keeps the profile private until explicitly included.
  const profileHost = document.querySelector('#careerProfileHost'); let profileForm, profileTools, profileStatus, profileSave, profileRevision = 0, profileBusy = false, profileVisible = false, profileLoaded = false, profileLoading = false;
  function profileControls(busy) { profileTools.busy(busy); profileForm.querySelectorAll('.career-actions button').forEach(button => { button.disabled = busy; }); }
  function initProfile() {
    if (profileForm) return;
    profileForm = node('form', undefined, 'career-profile-form'); profileTools = resumeFields(profileForm);
    profileStatus = node('p', '', 'portfolio-note'); profileStatus.setAttribute('role','status');
    const actions = node('div', undefined, 'career-actions'); profileSave = node('button', '프로필 저장', 'career-primary'); profileSave.type = 'submit';
    const pdf = node('button', '이력서 PDF 저장', 'career-secondary'); pdf.type = 'button'; const preview = node('button', '이력서 미리보기', 'career-secondary'); preview.type = 'button';
    const result = node('div', undefined, 'career-profile-preview');
    function render() { if (!profileForm.reportValidity()) return null; const value = profileTools.get(); result.replaceChildren(window.portfolioPresentation.resumeCard(value)); return result; }
    preview.addEventListener('click', () => { if (render()) result.scrollIntoView({ behavior: 'smooth' }); });
    pdf.addEventListener('click', async () => { const root = render(); if (!root) return; const version = epoch; pdf.disabled = true; profileStatus.textContent = '새 인쇄 화면에서 PDF 저장을 선택하세요. 작성 중인 내용은 이 화면에 유지됩니다.'; try { await window.portfolioPresentation.print(root, (profileTools.get().name || '나의') + ' 이력서'); } catch (e) { if (version === epoch) profileStatus.textContent = e.message; } finally { if (version === epoch) pdf.disabled = profileBusy || !profileLoaded; } });
    profileForm.addEventListener('input', () => { profileStatus.textContent = '저장하지 않은 변경 사항이 있습니다.'; result.replaceChildren(); });
    profileForm.addEventListener('submit', async event => {
      event.preventDefault(); if (profileBusy || !profileLoaded || !profileForm.reportValidity()) return;
      const version = epoch, request = profileRequest; profileBusy = true; profileControls(true);
      try { const data = await read('/api/career-profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: profileTools.get(), revision: profileRevision }) }, version);
        if (request !== profileRequest || version !== epoch) return; profileRevision = data.revision; profileTools.set(data.profile); profileStatus.textContent = '프로필을 저장했습니다. 기존 포트폴리오에 복사한 프로필은 자동으로 바뀌지 않습니다.';
      } catch (e) { if (version === epoch && request === profileRequest) profileStatus.textContent = e.message; }
      finally { if (version === epoch && request === profileRequest) { profileBusy = false; profileControls(false); } }
    });
    actions.append(profileSave, preview, pdf); profileForm.append(actions, profileStatus, node('p','PDF에는 영상이 재생되지 않으며, 외부 영상은 링크로 표시됩니다. 인쇄 설정에서 배경 그래픽을 켜면 디자인을 더 잘 유지할 수 있어요.','portfolio-note'), result); profileHost.append(profileForm);
  }
  async function showProfile(visible) {
    profileVisible = visible;
    if (!visible || !window.portfolioAuth.user) { if (profileLoading) { profileRequest++; profileLoading = false; } return; }
    // Route refreshes and background session checks must not discard a draft.
    if (profileLoaded || profileLoading) return;
    const request = ++profileRequest, version = epoch;
    initProfile(); profileLoading = true; profileControls(true); profileStatus.textContent = '프로필을 불러오는 중…';
    try { const data = await read('/api/career-profile', undefined, version); if (request !== profileRequest || !profileVisible) return;
      profileRevision = data.revision; profileTools.set(data.profile); profileStatus.textContent = ''; profileLoaded = true;
    } catch (e) { if (version === epoch && request === profileRequest) { profileStatus.textContent = e.message; return; } }
    finally { if (version === epoch && request === profileRequest) { profileLoading = false; profileControls(!profileLoaded); } }
  }
  document.addEventListener('portfolio:mypage-view', event => showProfile(event.detail.visible));
  function syncUser(user) { const next = user?.id || null; if (identity === next) return; identity = next; epoch++; profileRequest++; builderGeneration++; profileBusy = false; profileLoaded = false; profileLoading = false;
    if (builderReady) { introTools.reset(); resumeTools.set(blank()); noteEditor.tools.reset(); notes.clear(); activeNote = ''; selectedPosts = []; company.value = ''; role.value = ''; include.checked = false; resumeSnapshot.hidden = true; noteSelect.replaceChildren(); noteHelp.textContent = ''; busyBuilder(true); }
    if (profileTools) { profileTools.set(blank()); profileControls(true); profileStatus.textContent = ''; profileHost.querySelector('.career-profile-preview')?.replaceChildren(); }
    if (user && location.hash === '#mypage/resume') showProfile(true);
  }
  document.addEventListener('portfolio:auth', event => syncUser(event.detail.user));
  window.portfolioAuth.ready.then(() => { syncUser(window.portfolioAuth.user); if (location.hash === '#mypage/resume') showProfile(true); });
  window.portfolioCareer = { openBuilder, syncSelection, builderValues, busyBuilder, leaveBuilder };
})();
