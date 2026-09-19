/* ==========================================================================
 * github-api.js — 共享 GitHub API 客户端(玉国代码 / 控制台用)
 * 与 login.html、index.html 中的密钥片段一致,运行时拼接 + AES-256-GCM 解密
 * 用法:const token = await YG.getToken();  const res = await YG.gh(token, 'GET', '/...');
 * ========================================================================== */

(function(){
  const GH_OWNER = 'yuguo-yg-bit';
  const GH_REPO  = 'yuguo-coding';

  /* ===== 密钥片段(与 login.html / index.html 同步) ===== */
  var _ks1 = "vzKu69L/Og9muJ";
  var _kv  = "EgajaMIrPJPtNBd0";
  var _ks2 = "1dJdIcOcv1V2fz";
  var _kp  = "yuguo-site-2026-secret-key";
  var _ks3 = "9KIFrDxu61lnZP";
  var _kt  = "3F2yaBX6xpOsstB8Kg6IIQ==";
  var _ks4 = "EgvYMQdFvxiA==";

  function _b64ToBuf(b64){
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++){ bytes[i] = bin.charCodeAt(i); }
    return bytes;
  }

  async function _getToken(){
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(_kp));
    var key = await crypto.subtle.importKey('raw', keyMaterial, {name:'AES-GCM'}, false, ['decrypt']);
    var iv = _b64ToBuf(_kv);
    var ciphertext = _b64ToBuf(_ks1 + _ks2 + _ks3 + _ks4);
    var tag = _b64ToBuf(_kt);
    var combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext, 0);
    combined.set(tag, ciphertext.length);
    var plain = await crypto.subtle.decrypt({name:'AES-GCM', iv: iv}, key, combined);
    return new TextDecoder().decode(plain);
  }

  /* GitHub Contents/Issues API 封装(原样返回 fetch Response,便于上层判断 ok) */
  async function _gh(token, method, url, body){
    var opts = {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if(body !== undefined && body !== null){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch('https://api.github.com' + url, opts);
  }

  /* 读 JSON:返回对象(失败抛错) */
  async function ghJSON(token, method, url, body){
    var res = await _gh(token, method, url, body);
    if(!res.ok){
      var t = '';
      try{ t = (await res.text()).slice(0, 200); }catch(e){}
      throw new Error('API ' + res.status + ' ' + method + ' ' + url + (t ? ': ' + t : ''));
    }
    return res.json();
  }

  /* 读 JSON 文件:Contents API 返回的 content 字段是 base64,需要解码 */
  async function ghReadFile(token, path){
    var res = await _gh(token, 'GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path);
    if(!res.ok){
      if(res.status === 404) return null;
      var t = '';
      try{ t = (await res.text()).slice(0, 200); }catch(e){}
      throw new Error('API ' + res.status + ' GET ' + path + (t ? ': ' + t : ''));
    }
    var data = await res.json();
    var text = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { text: text, sha: data.sha, raw: data };
  }

  /* 写 JSON 文件:需要先拿到 sha,再 PUT 带 sha 的更新 */
  async function ghWriteFile(token, path, obj, message){
    var content = btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
    var body = { message: message, content: content };
    try{
      var cur = await ghReadFile(token, path);
      if(cur && cur.sha){ body.sha = cur.sha; }
    }catch(e){ /* 不存在就当新建 */ }
    return ghJSON(token, 'PUT', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path, body);
  }

  /* 读目录下所有 JSON 文件 */
  async function ghListDir(token, dirPath){
    var res = await _gh(token, 'GET', '/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + dirPath);
    if(!res.ok){
      if(res.status === 404) return [];
      throw new Error('API ' + res.status + ' GET dir ' + dirPath);
    }
    var list = await res.json();
    if(!Array.isArray(list)) return [];
    return list.filter(function(f){ return f.type === 'file'; });
  }

  /* 读取目录下全部 JSON 文件并解析为对象数组 */
  async function ghListJSON(token, dirPath){
    var files = await ghListDir(token, dirPath);
    var out = [];
    for(var i=0;i<files.length;i++){
      try{
        var r = await ghReadFile(token, dirPath + '/' + files[i].name);
        if(r && r.text){
          var obj = JSON.parse(r.text);
          obj.__fileName = files[i].name;
          obj.__sha = files[i].sha;
          out.push(obj);
        }
      }catch(e){ /* 跳过损坏文件 */ }
    }
    return out;
  }

  /* 文件转 base64(去掉前缀) */
  function fileToBase64(file){
    return new Promise(function(resolve, reject){
      var reader = new FileReader();
      reader.onload = function(){ resolve(reader.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* SHA-256(hex) */
  async function sha256Hex(text){
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function(b){
      return b.toString(16).padStart(2,'0');
    }).join('');
  }

  /* ===== 项目状态枚举(前端 + 客服共用) ===== */
  const PROJECT_STATUS = {
    pending_review : { label: '待客服确认', color: '#FFA94D' },
    waiting_develop: { label: '待开发',     color: '#4D8DFF' },
    developing     : { label: '开发中',     color: '#A78BFA' },
    testing        : { label: '测试验收',   color: '#35D6F5' },
    delivered      : { label: '已交付',     color: '#34D399' },
    closed         : { label: '已关闭',     color: '#6B7280' }
  };
  const APPLY_STATUS = {
    pending_staff_review: { label: '审核中',   color: '#FFA94D' },
    approved             : { label: '已通过',   color: '#34D399' },
    rejected             : { label: '已驳回',   color: '#FF6B6B' }
  };

  /* 申请 ID:时间戳后6位 + 4位随机,前端直接生成避免冲突 */
  function genApplyId(){
    var ts = Date.now().toString().slice(-6);
    var rand = Math.random().toString(36).slice(2, 6);
    return 'app_' + ts + '_' + rand;
  }

  /* 图片文件名:时间戳_安全文件名 */
  function genImageName(file){
    return Date.now() + '_' + file.name.replace(/[^\w.\-]/g, '_').slice(0, 80);
  }

  /* 友好时间 */
  function fmtTime(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return iso;
    var p = function(n){ return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtDate(iso){
    if(!iso) return '';
    var d = new Date(iso);
    if(isNaN(d.getTime())) return iso;
    var p = function(n){ return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
  }

  /* 暴露 API */
  window.YG = window.YG || {};
  window.YG.GH_OWNER = GH_OWNER;
  window.YG.GH_REPO  = GH_REPO;
  window.YG.getToken = _getToken;
  window.YG.gh       = _gh;        // 原 fetch Response
  window.YG.ghJSON   = ghJSON;     // 直接返回对象,失败抛错
  window.YG.ghReadFile   = ghReadFile;
  window.YG.ghWriteFile  = ghWriteFile;
  window.YG.ghListDir    = ghListDir;
  window.YG.ghListJSON   = ghListJSON;
  window.YG.fileToBase64 = fileToBase64;
  window.YG.sha256Hex    = sha256Hex;
  window.YG.PROJECT_STATUS = PROJECT_STATUS;
  window.YG.APPLY_STATUS   = APPLY_STATUS;
  window.YG.genApplyId  = genApplyId;
  window.YG.genImageName = genImageName;
  window.YG.fmtTime = fmtTime;
  window.YG.fmtDate = fmtDate;
})();