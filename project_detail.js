/* ==========================================================================
 * project_detail.js — 项目详情
 *  - 读 projects/proj_xxx.json(轮询 30s/120s)
 *  - 渲染基础信息 / 客服备注 / 附件 / 时间线
 *  - 用户追加需求:上传图片 + push 一条 demandLog
 * ========================================================================== */

(function(){
  'use strict';

  const PHONE = localStorage.getItem('yuguo_user');
  if(!PHONE){ location.href = 'login.html'; return; }

  /* 取 query 中的 project 文件名 */
  const params = new URLSearchParams(location.search);
  const fileName = params.get('project');
  if(!fileName){ location.href = 'dashboard.html'; return; }

  const projectPath = 'users/' + PHONE + '/projects/' + fileName;

  /* ===== DOM ===== */
  const el = {
    avatar   : document.getElementById('avatar'),
    uname    : document.getElementById('uname'),
    uphone   : document.getElementById('uphone'),
    logout   : document.getElementById('logout'),
    title    : document.getElementById('pr-title'),
    sub      : document.getElementById('pr-sub'),
    status   : document.getElementById('pr-status'),
    syncDot  : document.getElementById('sync-dot'),
    syncText : document.getElementById('sync-text'),
    m_id     : document.getElementById('m-id'),
    m_apply  : document.getElementById('m-apply'),
    m_create : document.getElementById('m-create'),
    m_contact: document.getElementById('m-contact'),
    m_desc   : document.getElementById('m-desc'),
    remarkBlock    : document.getElementById('remark-block'),
    remarkCurrent  : document.getElementById('remark-current'),
    remarkHistory  : document.getElementById('remark-history'),
    attachGrid : document.getElementById('attach-grid'),
    attachCount: document.getElementById('attach-count'),
    timeline : document.getElementById('timeline'),
    adForm   : document.getElementById('add-form'),
    adContent: document.getElementById('ad-content'),
    adFiles  : document.getElementById('ad-files'),
    adSubmit : document.getElementById('ad-submit'),
    adProgress: document.getElementById('ad-progress'),
    toast    : document.getElementById('toast')
  };

  /* 侧栏用户信息 */
  el.avatar.textContent = PHONE.slice(0, 2);
  el.uname.textContent  = '用户 ' + PHONE.slice(0, 3) + '****' + PHONE.slice(-2);
  el.uphone.textContent = PHONE;

  el.logout.addEventListener('click', function(){
    if(!confirm('确定退出登录吗?')) return;
    localStorage.removeItem('yuguo_user');
    location.href = 'login.html';
  });

  /* ===== 工具 ===== */
  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  let toastTimer = null;
  function toast(msg, type){
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (type === 'err' ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      el.toast.className = 'toast' + (type === 'err' ? ' err' : '');
    }, 2600);
  }
  function setSync(state, text){
    el.syncDot.className = 'sync-dot ' + (state || '');
    el.syncText.textContent = text;
  }
  function setProgress(text, type){
    el.adProgress.textContent = text;
    el.adProgress.className = 'progress' + (type ? ' ' + type : '');
  }

  /* ===== 状态 ===== */
  const cache = {
    token: null,
    project: null,
    inited: false
  };

  /* ============================================================
   *  加载 + 渲染
   * ============================================================ */
  async function load(){
    if(cache.inited) setSync('syncing', '同步中…');
    try{
      if(!cache.token) cache.token = await YG.getToken();
      const r = await YG.ghReadFile(cache.token, projectPath);
      if(!r){
        toast('项目文件不存在', 'err');
        setTimeout(function(){ location.href = 'dashboard.html'; }, 1200);
        return;
      }
      cache.project = JSON.parse(r.text);
      render();
      setSync('', '已同步 · ' + YG.fmtTime(new Date().toISOString()));
    }catch(err){
      console.error(err);
      setSync('error', '同步失败: ' + err.message);
      if(/401|403/.test(err.message)) cache.token = null;
    }finally{
      cache.inited = true;
    }
  }

  function render(){
    const p = cache.project;
    if(!p) return;

    document.title = (p.projectName || '项目') + ' — 玉国代码';
    el.title.textContent = p.projectName || '未命名项目';
    el.sub.textContent = '// ' + (p.projectId || fileName);

    const st = YG.PROJECT_STATUS[p.projectStatus] || YG.PROJECT_STATUS.pending_review;
    el.status.textContent = st.label;
    el.status.style.color = st.color;

    el.m_id.textContent      = p.projectId || fileName.replace(/\.json$/i, '');
    el.m_apply.textContent   = p.applyId || '—';
    el.m_create.textContent  = YG.fmtTime(p.createTime);
    el.m_contact.textContent = p.contact || PHONE;
    el.m_desc.textContent    = p.basicFunction || '(无)';

    /* 客服备注 */
    const cur = p.staffRemark;
    if(cur && cur.trim()){
      el.remarkCurrent.innerHTML =
        '<div class="desc-box" style="margin-bottom:14px">' + escapeHtml(cur) + '</div>';
      el.remarkBlock.style.display = 'block';
    }else{
      el.remarkCurrent.innerHTML = '';
    }
    const history = Array.isArray(p.staffRemarks) ? p.staffRemarks : [];
    if(history.length){
      el.remarkHistory.innerHTML = '<div style="font-family:var(--mono);font-size:12px;color:var(--muted);margin:14px 0 8px">历史备注</div>';
      history.forEach(function(r){
        const item = document.createElement('div');
        item.className = 'tl-item tl-staff';
        item.innerHTML =
          '<div class="tl-head">' +
            '<span class="tl-time"></span>' +
            '<span class="tl-by tl-by-staff">客服</span>' +
          '</div>' +
          '<div class="tl-content"></div>';
        item.querySelector('.tl-time').textContent = YG.fmtTime(r.time);
        item.querySelector('.tl-content').textContent = r.content || '';
        el.remarkHistory.appendChild(item);
      });
    }else{
      el.remarkHistory.innerHTML = '';
    }

    /* 附件 */
    const files = Array.isArray(p.attachFiles) ? p.attachFiles : [];
    el.attachCount.textContent = files.length ? '(' + files.length + ' 张)' : '';
    el.attachGrid.innerHTML = '';
    if(files.length === 0){
      el.attachGrid.innerHTML = '<div class="attach-empty">暂无附件</div>';
    }else{
      files.forEach(function(rel){
        const a = document.createElement('a');
        a.href = 'https://github.com/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/blob/main/' + rel;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = rel;
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.alt = rel;
        /* raw.githubusercontent 直接显示图片 */
        img.src = 'https://raw.githubusercontent.com/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/main/' + rel;
        img.onerror = function(){
          /* 兜底:显示文件名 */
          img.replaceWith(Object.assign(document.createElement('div'), {
            textContent: rel.split('/').pop(),
            style: 'padding:14px;font-family:var(--mono);font-size:12px;color:var(--muted);text-align:center;line-height:1.4'
          }));
        };
        a.appendChild(img);
        el.attachGrid.appendChild(a);
      });
    }

    /* 时间线(demandLogs) */
    const logs = Array.isArray(p.demandLogs) ? p.demandLogs : [];
    el.timeline.innerHTML = '';
    if(logs.length === 0){
      el.timeline.innerHTML = '<div class="tl-empty">暂无日志记录</div>';
    }else{
      logs.forEach(function(log){
        el.timeline.appendChild(renderLog(log));
      });
    }
  }

  function renderLog(log){
    const item = document.createElement('div');
    const by = (log.by || 'system');
    const action = log.action || '';

    if(action === 'status_change'){
      item.className = 'tl-item tl-status';
      const fromSt = YG.PROJECT_STATUS[log.from] || { label: log.from || '?' };
      const toSt   = YG.PROJECT_STATUS[log.to]   || { label: log.to   || '?' };
      item.innerHTML =
          '<div class="tl-head">' +
            '<span class="tl-time"></span>' +
            '<span class="tl-by tl-by-system">状态变更</span>' +
          '</div>' +
          '<div class="tl-content"></div>';
      item.querySelector('.tl-time').textContent = YG.fmtTime(log.time);
      item.querySelector('.tl-content').textContent =
        '状态从「' + fromSt.label + '」变更为「' + toSt.label + '」';
      return item;
    }

    item.className = 'tl-item ' + (by === 'staff' ? 'tl-staff' : 'tl-user');
    item.innerHTML =
        '<div class="tl-head">' +
          '<span class="tl-time"></span>' +
          '<span class="tl-by ' + (by === 'staff' ? 'tl-by-staff' : 'tl-by-user') + '">' +
            (by === 'staff' ? '客服' : '用户') +
          '</span>' +
          (action === 'add_requirement' ? '<span class="tl-by tl-by-user" style="opacity:.7">追加需求</span>' : '') +
          (log.attachFiles && log.attachFiles.length
            ? '<span class="tl-by tl-by-user" style="opacity:.7">' + log.attachFiles.length + ' 张附件</span>'
            : '') +
        '</div>' +
        '<div class="tl-content"></div>';
    item.querySelector('.tl-time').textContent = YG.fmtTime(log.time);
    item.querySelector('.tl-content').textContent = log.content || (action === 'add_requirement' ? '(无内容)' : '');
    return item;
  }

  /* ============================================================
   *  轮询
   * ============================================================ */
  const POLL_FRONT = 30000;
  const POLL_BACK  = 120000;
  let pollTimer = null;
  let failStreak = 0;

  function schedule(ms){
    clearTimeout(pollTimer);
    pollTimer = setTimeout(tick, ms);
  }
  async function tick(){
    if(document.visibilityState !== 'visible'){
      schedule(POLL_BACK);
      return;
    }
    try{
      await load();
      failStreak = 0;
      schedule(POLL_FRONT);
    }catch(e){
      failStreak++;
      const backoff = Math.min(POLL_FRONT * Math.pow(2, failStreak - 1), 300000);
      schedule(backoff);
    }
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible'){
      failStreak = 0;
      tick();
    }
  });

  /* ============================================================
   *  追加需求
   * ============================================================ */
  el.adForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const content = el.adContent.value.trim();
    const files = Array.from(el.adFiles.files || []);

    if(!content && files.length === 0){
      setProgress('请填写需求描述或上传附件', 'err');
      return;
    }
    if(content && content.length < 4){
      setProgress('描述太短啦,至少 4 个字', 'err');
      return;
    }
    if(files.length > 9){ setProgress('附件一次最多 9 张', 'err'); return; }
    for(let i=0;i<files.length;i++){
      if(files[i].size > 5 * 1024 * 1024){
        setProgress('"' + files[i].name + '" 超过 5MB', 'err');
        return;
      }
    }

    el.adSubmit.disabled = true;
    el.adSubmit.textContent = '提交中…';

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;

      /* 1. 上传附件 */
      const newAttach = [];
      if(files.length > 0){
        const dir = 'uploads/' + PHONE + '/project_attach';
        for(let i=0;i<files.length;i++){
          setProgress('上传附件 ' + (i+1) + '/' + files.length + '…', '');
          const content = await YG.fileToBase64(files[i]);
          const safeName = YG.genImageName(files[i]);
          const path = dir + '/' + safeName;
          await YG.ghJSON(token, 'PUT',
            '/repos/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/contents/' + path,
            { message: '项目追加附件: ' + (cache.project.projectName || fileName), content: content }
          );
          newAttach.push(path);
        }
      }

      /* 2. 读取最新 project.json(避免覆盖客服的并发修改) */
      setProgress('写入日志…', '');
      const fresh = await YG.ghReadFile(token, projectPath);
      if(!fresh){ throw new Error('项目文件丢失'); }
      const proj = JSON.parse(fresh.text);

      const log = {
        time: new Date().toISOString(),
        by: 'user',
        action: 'add_requirement',
        content: content || '(仅附附件)',
        attachFiles: newAttach
      };
      proj.demandLogs = Array.isArray(proj.demandLogs) ? proj.demandLogs : [];
      proj.demandLogs.push(log);
      /* 合并到项目 attachFiles 总表(便于客服一览) */
      proj.attachFiles = (proj.attachFiles || []).concat(newAttach);

      await YG.ghWriteFile(token, projectPath, proj,
        '追加需求: ' + (proj.projectName || fileName) + ' - ' + PHONE);

      setProgress('已提交', 'ok');
      toast('追加需求已提交,客服会尽快查看');

      /* 3. 清空 + 立即刷新 */
      el.adContent.value = '';
      el.adFiles.value = '';
      el.adSubmit.disabled = false;
      el.adSubmit.textContent = '追加需求';
      cache.token = token;
      failStreak = 0;
      tick();

    }catch(err){
      console.error(err);
      setProgress('提交失败:' + err.message, 'err');
      el.adSubmit.disabled = false;
      el.adSubmit.textContent = '追加需求';
    }
  });

  /* ============================================================
   *  启动
   * ============================================================ */
  load().then(tick);
})();