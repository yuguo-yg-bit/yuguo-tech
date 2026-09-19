/* ==========================================================================
 * dashboard.js — 控制台总览面板
 *  - 拉取 projects/ + project_applications/ 两个目录
 *  - 30s(前台) / 120s(后台) 轮询,失败指数退避
 *  - 模态弹窗:生成 app_xxx.json + 上传图片 + 创建 issue
 *  - 申请状态可见:pending_staff_review / approved / rejected
 * ========================================================================== */

(function(){
  'use strict';

  const PHONE = localStorage.getItem('yuguo_user');
  if(!PHONE){
    location.href = 'login.html';
    return;
  }

  /* ===== DOM 引用 ===== */
  const el = {
    avatar     : document.getElementById('avatar'),
    uname      : document.getElementById('uname'),
    uphone     : document.getElementById('uphone'),
    welcome    : document.getElementById('welcome'),
    logout     : document.getElementById('logout'),
    pendingTitle: document.getElementById('pending-title'),
    pendingList : document.getElementById('pending-list'),
    pendingCount: document.getElementById('pending-count'),
    projectsList: document.getElementById('projects-list'),
    projectsCount: document.getElementById('projects-count'),
    emptyState : document.getElementById('empty-state'),
    syncDot    : document.getElementById('sync-dot'),
    syncText   : document.getElementById('sync-text'),
    fabAdd     : document.getElementById('fab-add'),
    modal      : document.getElementById('apply-modal'),
    modalClose : document.getElementById('modal-close'),
    apCancel   : document.getElementById('ap-cancel'),
    apForm     : document.getElementById('apply-form'),
    apName     : document.getElementById('ap-name'),
    apDesc     : document.getElementById('ap-desc'),
    apFiles    : document.getElementById('ap-files'),
    apContact  : document.getElementById('ap-contact'),
    apProgress : document.getElementById('ap-progress'),
    apSubmit   : document.getElementById('ap-submit'),
    toast      : document.getElementById('toast')
  };

  /* ===== 侧栏用户信息 ===== */
  el.avatar.textContent  = PHONE.slice(0, 2);
  el.uname.textContent   = '用户 ' + PHONE.slice(0, 3) + '****' + PHONE.slice(-2);
  el.uphone.textContent  = PHONE;
  el.welcome.textContent = '// welcome back, ' + PHONE;
  el.apContact.value     = PHONE;

  /* ===== 退出登录 ===== */
  el.logout.addEventListener('click', function(){
    if(!confirm('确定退出登录吗?')) return;
    localStorage.removeItem('yuguo_user');
    location.href = 'login.html';
  });

  /* ===== 工具:防抖 ===== */
  function debounce(fn, ms){
    var t;
    return function(){
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(ctx, args); }, ms);
    };
  }

  /* ===== 工具:toast ===== */
  let toastTimer = null;
  function toast(msg, type){
    el.toast.textContent = msg;
    el.toast.style.borderColor = type === 'err' ? 'var(--red)' : 'var(--cyan)';
    el.toast.style.color = type === 'err' ? '#FF9E8E' : 'var(--cyan)';
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      el.toast.classList.remove('show');
    }, 2600);
  }

  /* ===== 同步状态指示 ===== */
  function setSync(state, text){
    el.syncDot.className = 'sync-dot ' + (state || '');
    el.syncText.textContent = text;
  }

  /* ===== 状态:本地缓存(用于检测变化) ===== */
  const cache = {
    projects: [],
    applications: [],
    token: null,
    inited: false
  };

  /* ============================================================
   *  核心:加载 projects + applications
   * ============================================================ */
  async function loadAll(){
    if(cache.inited) setSync('syncing', '同步中…');
    try{
      if(!cache.token) cache.token = await YG.getToken();

      const [projects, apps] = await Promise.all([
        YG.ghListJSON(cache.token, 'users/' + PHONE + '/projects').catch(function(){ return []; }),
        YG.ghListJSON(cache.token, 'users/' + PHONE + '/project_applications').catch(function(){ return []; })
      ]);

      /* projects:按 createTime / __fileName 倒序 */
      projects.sort(function(a, b){
        return (b.createTime || '').localeCompare(a.createTime || '')
            || (b.__fileName || '').localeCompare(a.__fileName || '');
      });
      apps.sort(function(a, b){
        return (b.applyTime || '').localeCompare(a.applyTime || '');
      });

      cache.projects = projects;
      cache.applications = apps;

      render();
      setSync('', '已同步 · ' + YG.fmtTime(new Date().toISOString()));
    }catch(err){
      console.error(err);
      setSync('error', '同步失败: ' + err.message);
      /* token 失效时清空,下次重新取 */
      if(/401|403/.test(err.message)) cache.token = null;
    }finally{
      cache.inited = true;
    }
  }

  /* ============================================================
   *  渲染
   * ============================================================ */
  function render(){
    /* 申请中(只展示未处理的) */
    const pending = cache.applications.filter(function(a){
      return a.status === 'pending_staff_review';
    });
    el.pendingCount.textContent = pending.length;
    el.pendingList.innerHTML = '';
    if(pending.length > 0){
      el.pendingTitle.style.display = 'flex';
      pending.forEach(function(a){
        el.pendingList.appendChild(renderApplyCard(a));
      });
    }else{
      el.pendingTitle.style.display = 'none';
    }

    /* 已处理的申请折叠展示 */
    const processed = cache.applications.filter(function(a){
      return a.status !== 'pending_staff_review';
    });
    /* 先清掉旧的 wrap */
    const oldWrap = document.getElementById('history-wrap');
    if(oldWrap) oldWrap.remove();
    if(processed.length){
      const wrap = document.createElement('div');
      wrap.id = 'history-wrap';
      wrap.style.cssText = 'margin-top:14px;font-family:var(--mono);font-size:12px;color:var(--muted);';
      const approved = processed.filter(function(a){ return a.status === 'approved'; }).length;
      const rejected = processed.filter(function(a){ return a.status === 'rejected'; }).length;
      wrap.textContent = '历史申请:' + processed.length + ' 条 · 已通过 ' + approved + ' / 已驳回 ' + rejected;
      el.pendingList.parentNode.insertBefore(wrap, el.pendingList.nextSibling);
    }

    /* 我的项目 */
    el.projectsCount.textContent = cache.projects.length;
    el.projectsList.innerHTML = '';
    if(cache.projects.length === 0){
      el.emptyState.style.display = 'block';
    }else{
      el.emptyState.style.display = 'none';
      cache.projects.forEach(function(p){
        el.projectsList.appendChild(renderProjectCard(p));
      });
    }
  }

  function renderProjectCard(p){
    const div = document.createElement('div');
    div.className = 'project-card';
    const st = YG.PROJECT_STATUS[p.projectStatus] || YG.PROJECT_STATUS.pending_review;
    div.style.setProperty('--card-accent', st.color);
    div.innerHTML =
      '<div class="card-head">' +
        '<div class="card-name"></div>' +
        '<span class="status-badge" style="color:' + st.color + '"></span>' +
      '</div>' +
      '<div class="card-meta"></div>' +
      '<div class="card-desc"></div>' +
      '<div class="card-foot">' +
        '<span>ID: ' + escapeHtml(p.projectId || p.__fileName || '') + '</span>' +
        '<span class="arrow">查看详情 →</span>' +
      '</div>';
    div.querySelector('.card-name').textContent = p.projectName || '未命名项目';
    div.querySelector('.status-badge').textContent = st.label;
    div.querySelector('.card-meta').textContent = '创建于 ' + YG.fmtDate(p.createTime);
    div.querySelector('.card-desc').textContent = p.basicFunction || '暂无功能描述';
    div.addEventListener('click', function(){
      location.href = 'project_detail.html?project=' + encodeURIComponent(p.__fileName || '');
    });
    return div;
  }

  function renderApplyCard(a){
    const div = document.createElement('div');
    div.className = 'apply-card';
    const st = YG.APPLY_STATUS[a.status] || YG.APPLY_STATUS.pending_staff_review;
    div.innerHTML =
      '<div class="card-head">' +
        '<div class="card-name"></div>' +
        '<span class="status-badge" style="color:' + st.color + '"></span>' +
      '</div>' +
      '<div class="card-meta"></div>' +
      '<div class="card-desc"></div>' +
      '<div class="card-foot" style="border-top:1px solid rgba(255,169,77,.18);padding-top:10px;margin-top:8px">' +
        '<span>申请 ID: ' + escapeHtml(a.applyId || '') + '</span>' +
        '<span style="color:var(--orange)">等待客服处理…</span>' +
      '</div>';
    div.querySelector('.card-name').textContent = a.projectName || '未命名申请';
    div.querySelector('.status-badge').textContent = st.label;
    div.querySelector('.card-meta').textContent = '提交于 ' + YG.fmtTime(a.applyTime);
    div.querySelector('.card-desc').textContent = a.basicFunction || '暂无功能描述';
    return div;
  }

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ============================================================
   *  轮询策略
   *  - 前台 30s,后台 120s
   *  - 失败指数退避,最多 5 分钟
   *  - 切回前台立即拉一次
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
      await loadAll();
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
   *  模态弹窗
   * ============================================================ */
  function openModal(){
    el.modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(function(){ el.apName.focus(); }, 100);
  }
  function closeModal(){
    el.modal.classList.remove('show');
    document.body.style.overflow = '';
    el.apForm.reset();
    el.apContact.value = PHONE;
    el.apProgress.textContent = '';
    el.apProgress.className = 'progress';
    el.apSubmit.disabled = false;
    el.apSubmit.textContent = '提交联系申请';
  }
  el.fabAdd.addEventListener('click', openModal);
  el.modalClose.addEventListener('click', closeModal);
  el.apCancel.addEventListener('click', closeModal);
  el.modal.addEventListener('click', function(e){
    if(e.target === el.modal) closeModal();
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && el.modal.classList.contains('show')) closeModal();
  });

  /* 提交申请 */
  el.apForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const name    = el.apName.value.trim();
    const desc    = el.apDesc.value.trim();
    const contact = el.apContact.value.trim() || PHONE;
    const files   = Array.from(el.apFiles.files || []);

    if(!name){ setProgress('请填写项目名称', 'err'); return; }
    if(name.length > 40){ setProgress('项目名称不超过 40 字', 'err'); return; }
    if(!desc){ setProgress('请填写基本功能描述', 'err'); return; }
    if(desc.length < 10){ setProgress('描述太短啦,至少 10 个字,方便客服理解需求', 'err'); return; }
    if(files.length > 9){ setProgress('附件一次最多 9 张', 'err'); return; }

    for(let i=0;i<files.length;i++){
      if(files[i].size > 5 * 1024 * 1024){
        setProgress('"' + files[i].name + '" 超过 5MB,请压缩后再上传', 'err');
        return;
      }
    }

    el.apSubmit.disabled = true;
    el.apSubmit.textContent = '请稍候…';

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;

      const applyId = YG.genApplyId();
      const now = new Date().toISOString();

      /* 1. 上传图片(失败由方案 A:不删除已传,等下次申请自动覆盖或被工单引用) */
      const attachFiles = [];
      if(files.length > 0){
        const attachDir = 'uploads/' + PHONE + '/project_attach';
        for(let i=0;i<files.length;i++){
          const file = files[i];
          setProgress('上传图片 ' + (i+1) + '/' + files.length + '…', '');
          const content = await YG.fileToBase64(file);
          const safeName = YG.genImageName(file);
          const path = attachDir + '/' + safeName;
          await YG.ghJSON(token, 'PUT',
            '/repos/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/contents/' + path,
            { message: '需求附图: ' + PHONE, content: content }
          );
          attachFiles.push(path);
        }
      }

      setProgress('写入申请工单…', '');

      /* 2. 生成申请 JSON */
      const appObj = {
        applyId       : applyId,
        phone         : PHONE,
        projectName   : name,
        basicFunction : desc,
        attachFiles   : attachFiles,
        contact       : contact,
        applyTime     : now,
        status        : 'pending_staff_review'
      };
      const appPath = 'users/' + PHONE + '/project_applications/' + applyId + '.json';
      await YG.ghWriteFile(token, appPath, appObj, '提交申请: ' + name + ' - ' + PHONE);

      /* 3. 创建 issue 通知客服 */
      setProgress('通知客服…', '');
      const issueBody =
        '**申请 ID：** `' + applyId + '`\n\n' +
        '**手机号：** ' + PHONE + '\n\n' +
        '**项目名称：** ' + name + '\n\n' +
        '**联系方式：** ' + contact + '\n\n' +
        '**申请时间：** ' + YG.fmtTime(now) + '\n\n' +
        '**功能描述：**\n> ' + desc.replace(/\n/g, '\n> ') + '\n\n' +
        '**附件(' + attachFiles.length + ' 张)：**\n' +
        (attachFiles.length
          ? attachFiles.map(function(p){
              return '- [' + p.split('/').pop() + '](https://github.com/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/blob/main/' + p + ')';
            }).join('\n')
          : '（无）') + '\n\n' +
        '---\n工单文件路径:`' + appPath + '`';
      await YG.ghJSON(token, 'POST',
        '/repos/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/issues',
        { title: '【新项目申请】' + PHONE + ' - ' + name, body: issueBody }
      );

      setProgress('已提交,请等待客服处理', 'ok');
      toast('申请已提交,客服审核后会出现在"我的项目"');

      /* 4. 立即刷新一次,新申请进入"审核中"列表 */
      setTimeout(function(){
        closeModal();
        cache.token = token; /* 复用 token */
        failStreak = 0;
        tick();
      }, 900);

    }catch(err){
      console.error(err);
      setProgress('提交失败:' + err.message, 'err');
      el.apSubmit.disabled = false;
      el.apSubmit.textContent = '提交联系申请';
    }
  });

  function setProgress(text, type){
    el.apProgress.textContent = text;
    el.apProgress.className = 'progress' + (type ? ' ' + type : '');
  }

  /* ============================================================
   *  启动
   * ============================================================ */
  loadAll().then(tick);
})();