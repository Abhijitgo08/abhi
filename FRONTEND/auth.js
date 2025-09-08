const API = 'http://localhost:5000/api/auth';

async function signup(e){
  e.preventDefault();
  const name = document.getElementById('signupName').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;

  const res = await fetch(`${API}/register`, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ name, email, password })
  });
  const data = await res.json();
  if(data.token){
    localStorage.setItem('token', data.token);
    localStorage.setItem('userName', data.user.name); // save username
    window.location.href = 'dashboard.html';
  } else alert(data.msg || 'Signup failed');
}

async function login(e){
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;

  const res = await fetch(`${API}/login`, {
    method:'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if(data.token){
    localStorage.setItem('token', data.token);
    localStorage.setItem('userName', data.user.name); // save username
    window.location.href = 'dashboard.html';
  } else alert(data.msg || 'Login failed');
}

document.getElementById('signupForm').addEventListener('submit', signup);
document.getElementById('loginForm').addEventListener('submit', login);
