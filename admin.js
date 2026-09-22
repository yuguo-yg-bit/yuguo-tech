/* ==========================================================================
 * admin.js — 管理员后台
 * 密码:27015150111(运行时 AES-256-GCM 解密验证)
 * 全权限:创建用户/审批申请/手动建项目/修改任意 JSON
 * ========================================================================== */

(function(){
  'use strict';

  /* ===== 管理员密码(AES-256-GCM 加密,运行时解密) ===== */
  var _kv = "EgajaMIrPJPtNBd0";
  /* 密文(ciphertext+tag,单段 base64) */
  var _kc = "6m3uhaCrXXUg284MbXMpvN+DDp6aEFo9xPgj";
  var _kt = "DG1zKbzfgw6emhBaPcT4Iw==";
  var _kp = "yuguo-site-2026-secret-key";

  /* base64 → Uint8Array */
  function _b64ToBuf(b64){
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++){ bytes[i] = bin.charCodeAt(i); }
    return bytes;
  }

  /* 运行时解密管理员密码 */
  async function _getAdminPwd(){
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(_kp));
    var key = await crypto.subtle.importKey('raw', keyMaterial, {name:'AES-GCM'}, false, ['decrypt']);
    var iv = _b64ToBuf(_kv);
    var combined = _b64ToBuf(_kc); // combined = ciphertext(11) + tag(16) = 27 bytes
    var tag = _b64ToBuf(_kt);
    var ciphertext = combined.slice(0, combined.length - tag.length);
    var plain = await crypto.subtle.decrypt({name:'AES-GCM', iv: iv}, key, ciphertext);
    return new TextDecoder().decode(plain);
  }

  const SESSION_KEY = 'yuguo_admin_session';
  var ADMIN_PWD = null; /* 运行时解密后赋值 */
  var SESSION_VAL = null;

  /* ===== 登录 ===== */
  const loginPage  = document.getElementById('login-page');
  const adminPage  = document.getElementById('admin-page');
  const loginForm  = document.getElementById('login-form');
  const loginPwd   = document.getElementById('login-pwd');
  const loginBtn   = document.getElementById('login-btn');
  const loginMsg   = document.getElementById('login-msg');

  async function initAdmin(){
    try {
      ADMIN_PWD = await _getAdminPwd();
      SESSION_VAL = 'admin_ok_' + ADMIN_PWD.slice(-6);
      console.log('[Admin] 密码解密成功:', ADMIN_PWD.slice(0,4) + '***');
    } catch(e) {
      console.error('[Admin] 密码解密失败:', e);
      document.getElementById('login-msg').textContent = '初始化失败: ' + e.message;
      document.getElementById('login-msg').className = 'msg err';
      return;
    }
    checkSession();
  }

  function checkSession(){
    if(!SESSION_VAL) return; /* 还没解密 */
    if(sessionStorage.getItem(SESSION_KEY) === SESSION_VAL){
      showAdmin();
    }
  }

  loginForm.addEventListener('submit', async function(e){
    e.preventDefault();
    if(!ADMIN_PWD){ loginMsg.textContent = '初始化中…稍等'; return; }
    if(loginPwd.value === ADMIN_PWD){
      sessionStorage.setItem(SESSION_KEY, SESSION_VAL);
      loginMsg.textContent = '';
      showAdmin();
    }else{
      loginMsg.textContent = '密码错误';
      loginMsg.className = 'msg err';
      loginPwd.value = '';
      loginPwd.focus();
    }
  });

  document.getElementById('logout-btn').addEventListener('click', function(){
    if(!confirm('确定退出管理后台?')) return;
    sessionStorage.removeItem(SESSION_KEY);
    adminPage.classList.remove('show');
    loginPage.style.display = 'flex';
    loginPwd.value = '';
    cache = { token:null, users:[], applications:[], projects:[] };
  });

  function showAdmin(){
    loginPage.style.display = 'none';
    adminPage.classList.add('show');
    initNav();
    /* 容错:loadAll 失败也允许进入后台 */
    loadAll().catch(function(e){
      console.error('[Admin] loadAll 失败但允许进入:', e);
    });
    startPoll();
  }

  /* ===== 全局状态 ===== */
  const cache = { token: null, users: [], applications: [], projects: [] };
  let currentPage = 'users';
  let appFilter = 'pending';
  let pendingConfirm = null; /* 确认框回调 */

  /* ===== 工具 ===== */
  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtTime(iso){ return YG ? YG.fmtTime(iso) : iso || ''; }
  function fmtDate(iso){ return YG ? YG.fmtDate(iso) : iso || ''; }

  let toastTimer = null;
  function toast(msg, type){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.className = 'toast'; }, 2800);
  }

  function setSync(id, state, text){
    const dot = document.getElementById('sync-dot-' + id);
    if(dot){ dot.className = 'sync-dot ' + (state || ''); }
    const txt = document.getElementById('sync-text-' + id);
    if(txt){ txt.textContent = text || '—'; }
  }

  /* ===== 模态框 ===== */
  function openModal(id){ document.getElementById(id).classList.add('show'); document.body.style.overflow = 'hidden'; }
  window.closeModal = function(id){
    document.getElementById(id).classList.remove('show');
    document.body.style.overflow = '';
  };
  document.querySelectorAll('.modal-overlay').forEach(function(el){
    el.addEventListener('click', function(e){
      if(e.target === el) closeModal(el.id);
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay.show').forEach(function(el){
        closeModal(el.id);
      });
    }
  });

  /* 确认框 */
  function confirm(text, icon, btnLabel, onConfirm){
    document.getElementById('cf-desc').textContent = text;
    document.getElementById('cf-icon').textContent = icon || '⚠️';
    document.getElementById('cf-btn').textContent = btnLabel || '确认';
    pendingConfirm = onConfirm;
    openModal('modal-confirm');
  }
  window.confirmAction = function(){
    if(pendingConfirm){ pendingConfirm(); pendingConfirm = null; }
    closeModal('modal-confirm');
  };

  /* ===== 导航 ===== */
  function initNav(){
    document.querySelectorAll('.nav a').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        const page = a.getAttribute('data-page');
        switchPage(page);
      });
    });
  }

  function switchPage(page){
    currentPage = page;
    document.querySelectorAll('.nav a').forEach(function(a){
      a.classList.toggle('active', a.getAttribute('data-page') === page);
    });
    ['users','applications','new-project'].forEach(function(p){
      document.getElementById('page-' + p).style.display = (p === page ? 'block' : 'none');
    });
  }

  /* ===== 加载全部数据 ===== */
  async function loadAll(){
    console.log('[Admin] 开始加载数据, repo: yuguo-coding');
    try{
      if(!cache.token) {
        console.log('[Admin] 正在解密 token...');
        cache.token = await YG.getToken();
        console.log('[Admin] token 解密成功,前缀:', cache.token.slice(0,4));
      }

      /* 拉所有用户目录 */
      console.log('[Admin] 正在请求 GET /repos/yuguo-yg-bit/yuguo-coding/contents/users');
      const userDirs = await YG.ghListDir(cache.token, 'users');
      console.log('[Admin] userDirs 返回:', userDirs);
      const users = [];
      for(let i=0;i<userDirs.length;i++){
        if(userDirs[i].type !== 'dir') continue;
        const phoneNum = userDirs[i].name;
        const r = await YG.ghReadFile(cache.token, 'users/' + phoneNum + '/profile.json').catch(function(){ return null; });
        if(r){
          try{
            var u = JSON.parse(r.text);
            u._phone = phoneNum;
            u._projectsDir = 'users/' + phoneNum + '/projects';
            u._appsDir = 'users/' + phoneNum + '/project_applications';
            users.push(u);
          }catch(e){}
        }
      }
      users.sort(function(a,b){ return (a._phone||'').localeCompare(b._phone||''); });
      cache.users = users;

      /* 拉所有申请 */
      const allApps = [];
      for(let i=0;i<users.length;i++){
        const apps = await YG.ghListJSON(cache.token, users[i]._appsDir).catch(function(){ return []; });
        apps.forEach(function(a){
          a._phone = users[i]._phone;
          allApps.push(a);
        });
      }
      allApps.sort(function(a,b){ return (b.applyTime||'').localeCompare(a.applyTime||''); });
      cache.applications = allApps;

      /* 拉所有项目 */
      const allProjects = [];
      for(let i=0;i<users.length;i++){
        const projs = await YG.ghListJSON(cache.token, users[i]._projectsDir).catch(function(){ return []; });
        projs.forEach(function(p){
          p._phone = users[i]._phone;
          allProjects.push(p);
        });
      }
      allProjects.sort(function(a,b){ return (b.createTime||'').localeCompare(a.createTime||''); });
      cache.projects = allProjects;

      updateStats();
      renderCurrent();

      const now = new Date();
      const t = fmtTime(now.toISOString());
      setSync('users', '', t);
      setSync('apps', '', t);

    }catch(err){
      console.error('YG loadAll error:', err);
      setSync('users', 'error', '加载失败');
      /* 把错误信息详细打出来方便调试 */
      var msg = err.message || String(err);
      toast('⚠️ 加载失败: ' + msg.slice(0, 200), 'err');
      if(/401|403|Token revoked/.test(msg)){ cache.token = null; }
    }
  }

  function updateStats(){
    document.getElementById('stat-users').textContent = cache.users.length;
    document.getElementById('stat-apps').textContent =
      cache.applications.filter(function(a){ return a.status === 'pending_staff_review'; }).length;
    document.getElementById('stat-projects').textContent = cache.projects.length;
    document.getElementById('stat-rejected').textContent =
      cache.applications.filter(function(a){ return a.status === 'rejected'; }).length;
  }

  function renderCurrent(){
    if(currentPage === 'users') renderUsers();
    else if(currentPage === 'applications') renderApplications();
    else if(currentPage === 'new-project') renderNewProject();
  }

  /* ============================================================
   *  用户管理
   * ============================================================ */
  function renderUsers(){
    const q = (document.getElementById('search-users') || {}).value || '';
    const filtered = q
      ? cache.users.filter(function(u){ return (u.phone||'').includes(q) || (u._phone||'').includes(q); })
      : cache.users;

    const area = document.getElementById('users-area');
    if(filtered.length === 0){
      area.innerHTML = '<div class="empty"><div class="icon">&lt;/&gt;</div><p>暂无注册用户</p></div>';
      return;
    }

    let html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>手机号</th><th>注册时间</th><th>项目数</th><th>申请数</th><th>操作</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(u){
      const phone = u._phone || u.phone || '?';
      const projCount = cache.projects.filter(function(p){ return p._phone === phone; }).length;
      const appCount  = cache.applications.filter(function(a){ return a._phone === phone; }).length;
      html += '<tr>' +
        '<td class="cell-phone">' + escapeHtml(phone) + '</td>' +
        '<td class="cell-time">' + fmtDate(u.createdAt) + '</td>' +
        '<td><span class="badge badge-blue">' + projCount + '</span></td>' +
        '<td><span class="badge badge-gray">' + appCount + '</span></td>' +
        '<td><div class="actions">' +
          '<button class="btn-sm btn-sm-blue" style="font-size:12px;padding:5px 10px" ' +
            'onclick="openUserProjects(\'' + escapeHtml(phone) + '\')">查看项目</button>' +
          '<button class="btn-sm btn-sm-ghost" style="font-size:12px;padding:5px 10px" ' +
            'onclick="openNewProjectFor(\'' + escapeHtml(phone) + '\')">建项目</button>' +
          '<button class="btn-sm btn-sm-ghost" style="font-size:12px;padding:5px 10px" ' +
            'onclick="resetUserPwd(\'' + escapeHtml(phone) + '\')">改密码</button>' +
        '</div></td></tr>';
    });
    html += '</tbody></table></div>';
    area.innerHTML = html;
  }

  window.renderUsers = renderUsers;

  /* 新建用户 */
  window.openNewUser = function(){
    document.getElementById('form-new-user').reset();
    document.getElementById('nu-progress').textContent = '';
    openModal('modal-new-user');
    setTimeout(function(){ document.getElementById('nu-phone').focus(); }, 100);
  };

  document.getElementById('form-new-user').addEventListener('submit', async function(e){
    e.preventDefault();
    const phone = document.getElementById('nu-phone').value.trim();
    const pwd   = document.getElementById('nu-pwd').value;
    const prog  = document.getElementById('nu-progress');
    const btn   = document.getElementById('nu-submit');

    if(!/^1\d{10}$/.test(phone)){ prog.textContent = '请输入正确的 11 位手机号'; prog.className='modal-progress err'; return; }
    if(pwd.length < 6){ prog.textContent = '密码至少 6 位'; prog.className='modal-progress err'; return; }

    btn.disabled = true; btn.textContent = '创建中…';

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;

      /* 检查是否已存在 */
      const existing = await YG.ghReadFile(token, 'users/' + phone + '/profile.json');
      if(existing){ throw new Error('该手机号已注册'); }

      /* 创建 profile.json */
      const pwdHash = await YG.sha256Hex(phone + ':' + pwd);
      const profile = {
        phone: phone,
        passwordHash: pwdHash,
        createdAt: new Date().toISOString(),
        projects: []
      };
      await YG.ghWriteFile(token, 'users/' + phone + '/profile.json', profile,
        '管理员新建用户: ' + phone);

      prog.textContent = '用户创建成功!'; prog.className = 'modal-progress ok';
      toast('用户 ' + phone + ' 创建成功', 'ok');
      setTimeout(function(){ closeModal('modal-new-user'); btn.disabled = false; btn.textContent = '创建用户'; }, 900);
      await loadAll();

    }catch(err){
      prog.textContent = '失败: ' + err.message; prog.className = 'modal-progress err';
      btn.disabled = false; btn.textContent = '创建用户';
    }
  });

  /* 重置密码 */
  window.resetUserPwd = function(phone){
    const newPwd = prompt('为用户 ' + phone + ' 设置新密码(至少 6 位):');
    if(!newPwd || newPwd.length < 6){ toast('密码不能少于 6 位', 'err'); return; }
    confirm('确定将用户 ' + phone + ' 的密码修改为: ' + newPwd + '?', '🔑', '确认修改', async function(){
      try{
        const token = cache.token || await YG.getToken();
        cache.token = token;
        const r = await YG.ghReadFile(token, 'users/' + phone + '/profile.json');
        if(!r) throw new Error('用户文件不存在');
        const profile = JSON.parse(r.text);
        profile.passwordHash = await YG.sha256Hex(phone + ':' + newPwd);
        await YG.ghWriteFile(token, 'users/' + phone + '/profile.json', profile,
          '管理员重置密码: ' + phone);
        toast('密码已修改', 'ok');
      }catch(err){
        toast('修改失败: ' + err.message, 'err');
      }
    });
  };

  /* 查看用户项目 */
  window.openUserProjects = function(phone){
    const projs = cache.projects.filter(function(p){ return p._phone === phone; });
    if(projs.length === 0){
      toast('该用户暂无项目', 'warn');
      return;
    }
    let html = '<p style="margin-bottom:14px;font-size:13px;color:var(--muted)">用户 ' + escapeHtml(phone) + ' 的项目:</p>';
    projs.forEach(function(p){
      const st = (YG.PROJECT_STATUS[p.projectStatus] || {label:'未知',color:'#6B7280'});
      html += '<div style="background:var(--panel);border:1px solid var(--line-soft);border-radius:10px;padding:14px 16px;margin-bottom:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<strong>' + escapeHtml(p.projectName || '未命名') + '</strong>' +
          '<span class="badge" style="color:' + st.color + ';border-color:currentColor;background:transparent;font-size:11px">' + st.label + '</span>' +
        '</div>' +
        '<div style="font-family:var(--mono);font-size:12px;color:var(--muted)">ID: ' + escapeHtml(p.projectId || p.__fileName || '') + ' · 创建: ' + fmtDate(p.createTime) + '</div>' +
      '</div>';
    });
    showInlinePanel('用户项目 — ' + phone, html);
  };

  /* 内联面板 */
  function showInlinePanel(title, html){
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.innerHTML =
      '<div class="modal" style="max-width:640px;max-height:80vh;display:flex;flex-direction:column">' +
        '<div class="modal-head">' +
          '<div><h3>' + escapeHtml(title) + '</h3></div>' +
          '<button class="modal-close" onclick="this.closest(\'.modal-overlay\').remove();document.body.style.overflow=\'\'">×</button>' +
        '</div>' +
        '<div class="modal-body" style="overflow-y:auto;flex:1;padding:18px 22px">' + html + '</div>' +
      '</div>';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
  }

  /* ============================================================
   *  申请审批
   * ============================================================ */
  window.setFilter = function(btn, type){
    if(type === 'applications'){
      appFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      renderApplications();
    }
  };

  function renderApplications(){
    const filtered = appFilter === 'all'
      ? cache.applications
      : cache.applications.filter(function(a){ return a.status === appFilter; });

    const area = document.getElementById('apps-area');
    if(filtered.length === 0){
      area.innerHTML = '<div class="empty"><div class="icon">📋</div><p>暂无此类申请</p></div>';
      return;
    }

    let html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>申请 ID</th><th>用户</th><th>项目名称</th><th>状态</th><th>提交时间</th><th>操作</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(a){
      const st = (YG.APPLY_STATUS[a.status] || {label:a.status||'?',color:'#6B7280'});
      const badgeClass =
        a.status === 'pending_staff_review' ? 'badge-orange' :
        a.status === 'approved' ? 'badge-green' : 'badge-red';
      html += '<tr>' +
        '<td class="cell-phone">' + escapeHtml(a.applyId || a.__fileName || '') + '</td>' +
        '<td class="cell-phone">' + escapeHtml(a._phone || a.phone || '') + '</td>' +
        '<td>' + escapeHtml(a.projectName || '—') + '</td>' +
        '<td><span class="badge ' + badgeClass + '">' + st.label + '</span></td>' +
        '<td class="cell-time">' + fmtTime(a.applyTime) + '</td>' +
        '<td><div class="actions">';
      if(a.status === 'pending_staff_review'){
        html += '<button class="btn-sm btn-sm-green" style="font-size:12px;padding:5px 10px" ' +
            'onclick="openReview(\'' + escapeHtml(a.applyId || a.__fileName || '') + '\')">审批</button>';
      }else{
        html += '<button class="btn-sm btn-sm-ghost" style="font-size:12px;padding:5px 10px" ' +
            'onclick="openReview(\'' + escapeHtml(a.applyId || a.__fileName || '') + '\')">查看</button>';
      }
      html += '</div></td></tr>';
    });
    html += '</tbody></table></div>';
    area.innerHTML = html;
  }

  /* 审批弹窗 */
  let reviewApp = null;
  window.openReview = function(applyId){
    reviewApp = cache.applications.find(function(a){ return (a.applyId || a.__fileName || '') === applyId; });
    if(!reviewApp){ toast('找不到申请', 'err'); return; }

    const st = (YG.APPLY_STATUS[reviewApp.status] || {label:reviewApp.status||'?',color:'#6B7280'});
    let html = '<div style="margin-bottom:16px;padding:14px 16px;background:var(--panel);border:1px solid var(--line-soft);border-radius:10px">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">' +
      '<div><strong>申请 ID:</strong> <span style="font-family:var(--mono)">' + escapeHtml(reviewApp.applyId || reviewApp.__fileName || '') + '</span></div>' +
      '<span class="badge" style="color:' + st.color + ';border-color:currentColor;background:transparent">' + st.label + '</span>' +
    '</div>';
    html += '<div style="font-size:13.5px;line-height:1.7">' +
      '<div><strong>用户:</strong> ' + escapeHtml(reviewApp._phone || reviewApp.phone || '') + '</div>' +
      '<div><strong>项目名称:</strong> ' + escapeHtml(reviewApp.projectName || '—') + '</div>' +
      '<div><strong>联系方式:</strong> ' + escapeHtml(reviewApp.contact || '—') + '</div>' +
      '<div><strong>提交时间:</strong> ' + fmtTime(reviewApp.applyTime) + '</div>' +
    '</div></div>';

    html += '<div style="margin-bottom:16px">' +
      '<div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">功能描述</div>' +
      '<div style="background:var(--bg);border:1px solid var(--line-soft);border-radius:10px;padding:12px 14px;font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word">' +
        escapeHtml(reviewApp.basicFunction || '(无)') +
      '</div></div>';

    if(reviewApp.attachFiles && reviewApp.attachFiles.length){
      html += '<div style="margin-bottom:16px">' +
        '<div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">附件</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      reviewApp.attachFiles.forEach(function(f){
        html += '<a href="https://github.com/' + YG.GH_OWNER + '/' + YG.GH_REPO + '/blob/main/' + f + '" target="_blank" ' +
          'style="display:inline-block;padding:6px 12px;background:var(--panel);border:1px solid var(--line-soft);border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--accent);transition:border-color .2s" ' +
          'onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--line-soft)\'">' +
          escapeHtml(f.split('/').pop()) + '</a>';
      });
      html += '</div></div>';
    }

    document.getElementById('review-title').textContent = '// ' + (reviewApp.projectName || applyId);
    document.getElementById('review-body').innerHTML = html;

    /* 驳回/通过按钮 */
    const btnReject   = document.getElementById('btn-reject');
    const btnApprove = document.getElementById('btn-approve');
    if(reviewApp.status === 'pending_staff_review'){
      btnReject.style.display = ''; btnApprove.style.display = '';
    }else{
      btnReject.style.display = 'none'; btnApprove.style.display = 'none';
    }

    openModal('modal-review');
  };

  /* 驳回 */
  window.doReject = async function(){
    if(!reviewApp) return;
    const remark = prompt('驳回原因(可选,会写入申请备注):') || '';
    closeModal('modal-review');

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;
      const applyId = reviewApp.applyId || reviewApp.__fileName;
      const phone   = reviewApp._phone || reviewApp.phone;
      const appPath = 'users/' + phone + '/project_applications/' + applyId;

      reviewApp.status = 'rejected';
      reviewApp.reviewRemark = remark;
      reviewApp.reviewTime   = new Date().toISOString();
      await YG.ghWriteFile(token, appPath, reviewApp, '驳回申请: ' + applyId + ' - ' + phone);

      toast('已驳回', 'ok');
      await loadAll();
    }catch(err){
      toast('驳回失败: ' + err.message, 'err');
    }
  };

  /* 通过并创建项目 */
  window.doApprove = async function(){
    if(!reviewApp) return;
    const remark = prompt('客服备注(排期、报价等,可选):') || '';
    closeModal('modal-review');

    const phone   = reviewApp._phone || reviewApp.phone;
    const appId   = reviewApp.applyId || reviewApp.__fileName;
    const projId  = 'proj_' + Date.now().toString().slice(-8);
    const now     = new Date().toISOString();

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;

      /* 1. 更新申请状态 */
      reviewApp.status     = 'approved';
      reviewApp.reviewTime = now;
      const appPath = 'users/' + phone + '/project_applications/' + appId;
      await YG.ghWriteFile(token, appPath, reviewApp, '审批通过: ' + appId + ' - ' + phone);

      /* 2. 创建正式项目 JSON */
      const projObj = {
        projectId: projId,
        applyId: appId,
        projectName: reviewApp.projectName || '未命名项目',
        basicFunction: reviewApp.basicFunction || '',
        attachFiles: reviewApp.attachFiles || [],
        contact: reviewApp.contact || phone,
        createTime: now,
        projectStatus: 'waiting_develop',
        staffRemark: remark || '',
        staffRemarks: remark ? [{time: now, content: remark}] : [],
        demandLogs: [{
          time: now,
          by: 'staff',
          action: 'approved',
          content: '申请已通过,项目创建'
        }]
      };
      const projPath = 'users/' + phone + '/projects/' + projId + '.json';
      await YG.ghWriteFile(token, projPath, projObj, '审批通过创建项目: ' + projId + ' - ' + phone);

      toast('项目 ' + projId + ' 创建成功!', 'ok');
      await loadAll();

    }catch(err){
      toast('创建失败: ' + err.message, 'err');
    }
  };

  /* ============================================================
   *  手动建项目
   * ============================================================ */
  function renderNewProject(){
    const area = document.getElementById('new-project-list');
    if(cache.projects.length === 0){
      area.innerHTML = '<div class="empty"><div class="icon">&lt;/&gt;</div><p>暂无项目,点击右上角按钮创建</p></div>';
      return;
    }
    let html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>项目 ID</th><th>用户</th><th>项目名称</th><th>状态</th><th>创建时间</th><th>操作</th>' +
      '</tr></thead><tbody>';
    cache.projects.forEach(function(p){
      const st = (YG.PROJECT_STATUS[p.projectStatus] || {label:'未知',color:'#6B7280'});
      const badgeClass =
        p.projectStatus === 'developing' ? 'badge-purple' :
        p.projectStatus === 'delivered'  ? 'badge-green'  :
        p.projectStatus === 'testing'    ? 'badge-cyan'  :
        p.projectStatus === 'closed'     ? 'badge-gray'  :
        'badge-blue';
      html += '<tr>' +
        '<td class="cell-phone">' + escapeHtml(p.projectId || p.__fileName || '') + '</td>' +
        '<td class="cell-phone">' + escapeHtml(p._phone || p.phone || '') + '</td>' +
        '<td>' + escapeHtml(p.projectName || '未命名') + '</td>' +
        '<td><span class="badge ' + badgeClass + '" style="color:' + st.color + ';border-color:currentColor;background:transparent">' + st.label + '</span></td>' +
        '<td class="cell-time">' + fmtDate(p.createTime) + '</td>' +
        '<td><div class="actions">' +
          '<button class="btn-sm btn-sm-blue" style="font-size:12px;padding:5px 10px" ' +
            'onclick="changeProjectStatus(\'' + escapeHtml(p.__fileName || '') + '\',\'' + escapeHtml(p._phone || '') + '\')">改状态</button>' +
          '<button class="btn-sm btn-sm-ghost" style="font-size:12px;padding:5px 10px" ' +
            'onclick="editProjectRemark(\'' + escapeHtml(p.__fileName || '') + '\',\'' + escapeHtml(p._phone || '') + '\')">改备注</button>' +
        '</div></td></tr>';
    });
    html += '</tbody></table></div>';
    area.innerHTML = html;
  }

  window.openNewProject = function(phone){
    document.getElementById('form-new-project').reset();
    document.getElementById('np-progress').textContent = '';
    if(phone) document.getElementById('np-phone').value = phone;
    /* 建议 proj ID */
    document.getElementById('np-id').value = 'proj_' + Date.now().toString().slice(-8);
    openModal('modal-new-project');
  };

  window.openNewProjectFor = function(phone){ openNewProject(phone); };

  document.getElementById('form-new-project').addEventListener('submit', async function(e){
    e.preventDefault();
    const phone   = document.getElementById('np-phone').value.trim();
    const projId  = document.getElementById('np-id').value.trim();
    const name    = document.getElementById('np-name').value.trim();
    const desc    = document.getElementById('np-desc').value.trim();
    const status  = document.getElementById('np-status').value;
    const remark  = document.getElementById('np-remark').value.trim();
    const prog    = document.getElementById('np-progress');
    const btn     = document.getElementById('np-submit');

    if(!/^1\d{10}$/.test(phone)){ prog.textContent = '手机号格式错误'; prog.className='modal-progress err'; return; }
    if(!projId){ prog.textContent = '项目 ID 不能为空'; prog.className='modal-progress err'; return; }
    if(!name){ prog.textContent = '项目名称不能为空'; prog.className='modal-progress err'; return; }

    btn.disabled = true; btn.textContent = '创建中…';

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;

      /* 确认用户存在 */
      const userR = await YG.ghReadFile(token, 'users/' + phone + '/profile.json');
      if(!userR){ throw new Error('用户 ' + phone + ' 不存在,请先创建用户'); }

      /* 检查 projId 不重复 */
      const projPath = 'users/' + phone + '/projects/' + projId + '.json';
      const exists = await YG.ghReadFile(token, projPath);
      if(exists){ throw new Error('项目 ID ' + projId + ' 已存在'); }

      const now = new Date().toISOString();
      const projObj = {
        projectId: projId,
        projectName: name,
        basicFunction: desc,
        attachFiles: [],
        contact: phone,
        createTime: now,
        projectStatus: status,
        staffRemark: remark,
        staffRemarks: remark ? [{time: now, content: remark}] : [],
        demandLogs: [{
          time: now,
          by: 'staff',
          action: 'created',
          content: '管理员手动创建项目,状态: ' + status
        }]
      };
      await YG.ghWriteFile(token, projPath, projObj, '管理员手动创建项目: ' + projId + ' - ' + phone);

      prog.textContent = '项目创建成功!'; prog.className = 'modal-progress ok';
      toast('项目 ' + projId + ' 创建成功', 'ok');
      setTimeout(function(){ closeModal('modal-new-project'); btn.disabled = false; btn.textContent = '创建项目'; }, 900);
      await loadAll();

    }catch(err){
      prog.textContent = '失败: ' + err.message; prog.className = 'modal-progress err';
      btn.disabled = false; btn.textContent = '创建项目';
    }
  });

  /* 改项目状态 */
  window.changeProjectStatus = async function(fileName, phone){
    const proj = cache.projects.find(function(p){ return (p.__fileName||'') === fileName; });
    if(!proj){ toast('找不到项目', 'err'); return; }

    const options = Object.keys(YG.PROJECT_STATUS).map(function(k){
      return k + ':' + YG.PROJECT_STATUS[k].label;
    }).join('\n');
    const input = prompt('请输入新状态(英文 key):\n\n可选:\n' + options + '\n\n当前: ' + proj.projectStatus);
    if(!input || input.trim() === proj.projectStatus) return;
    const newStatus = input.trim();
    if(!YG.PROJECT_STATUS[newStatus]){ toast('未知状态: ' + newStatus, 'err'); return; }

    confirm('确认将项目状态改为「' + YG.PROJECT_STATUS[newStatus].label + '」?', '🔄', '确认修改', async function(){
      try{
        const token = cache.token || await YG.getToken();
        cache.token = token;
        const projPath = 'users/' + phone + '/projects/' + fileName;
        const r = await YG.ghReadFile(token, projPath);
        const p = JSON.parse(r.text);
        const now = new Date().toISOString();
        p.demandLogs = p.demandLogs || [];
        p.demandLogs.push({
          time: now,
          by: 'staff',
          action: 'status_change',
          from: p.projectStatus,
          to: newStatus
        });
        p.projectStatus = newStatus;
        await YG.ghWriteFile(token, projPath, p, '管理员修改项目状态: ' + fileName);
        toast('状态已更新为 ' + YG.PROJECT_STATUS[newStatus].label, 'ok');
        await loadAll();
      }catch(err){
        toast('修改失败: ' + err.message, 'err');
      }
    });
  };

  /* 改项目备注 */
  window.editProjectRemark = async function(fileName, phone){
    const proj = cache.projects.find(function(p){ return (p.__fileName||'') === fileName; });
    if(!proj){ toast('找不到项目', 'err'); return; }

    const remark = prompt('输入新的客服备注:\n\n(当前备注会作为历史保留)', proj.staffRemark || '');
    if(remark === null) return;

    try{
      const token = cache.token || await YG.getToken();
      cache.token = token;
      const projPath = 'users/' + phone + '/projects/' + fileName;
      const r = await YG.ghReadFile(token, projPath);
      const p = JSON.parse(r.text);
      const now = new Date().toISOString();
      p.staffRemarks = p.staffRemarks || [];
      p.staffRemarks.push({time: now, content: remark});
      p.staffRemark = remark;
      await YG.ghWriteFile(token, projPath, p, '管理员修改备注: ' + fileName);
      toast('备注已更新', 'ok');
      await loadAll();
    }catch(err){
      toast('修改失败: ' + err.message, 'err');
    }
  };

  /* ============================================================
   *  轮询
   * ============================================================ */
  let pollTimer = null;
  function startPoll(){
    clearTimeout(pollTimer);
    async function tick(){
      try{ await loadAll(); }catch(e){}
      pollTimer = setTimeout(tick, 45000);
    }
    pollTimer = setTimeout(tick, 45000);
  }

  /* ===== 启动 ===== */
  initAdmin();

})();