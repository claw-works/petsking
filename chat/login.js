// chat/login.js — 登录/注册页：拿到 token 后跳回聊天页
const TOKEN_KEY = 'petsking_token';
const params = new URLSearchParams(location.search);
const PET_ID = params.get('pet') || 'blue-whale';

const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authTitle = document.getElementById('auth-title');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const registerBtn = document.getElementById('register-btn');

async function loadPetName() {
  let name = PET_ID;
  try {
    const res = await fetch(`../pets/${PET_ID}/pet.json`);
    const manifest = await res.json();
    if (manifest.meta && manifest.meta.name) name = manifest.meta.name;
  } catch {
    // 拿不到就用 id 兜底，不影响后续流程
  }
  document.title = '登录 · ' + name;
  authTitle.textContent = '登录后和 ' + name + ' 聊天';
}

async function authRequest(path) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '请求失败');
  return body.token;
}

async function handleAuth(path) {
  authError.textContent = '';
  try {
    const token = await authRequest(path);
    localStorage.setItem(TOKEN_KEY, token);
    location.href = 'index.html?pet=' + encodeURIComponent(PET_ID);
  } catch (e) {
    authError.textContent = e.message;
  }
}

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleAuth('/api/login');
});
registerBtn.addEventListener('click', () => handleAuth('/api/register'));

loadPetName();

// 已经登录过就直接跳回聊天页，不用再填一遍表单
if (localStorage.getItem(TOKEN_KEY)) {
  location.href = 'index.html?pet=' + encodeURIComponent(PET_ID);
}
