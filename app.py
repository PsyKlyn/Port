import os, json, re, secrets
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify, session, redirect, send_from_directory, abort, render_template_string
from werkzeug.security import generate_password_hash, check_password_hash
import pyotp
import psycopg2
from psycopg2.extras import RealDictCursor

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=BASE, static_url_path='')
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.environ.get('RENDER') == 'true')

DATABASE_URL = os.environ.get('DATABASE_URL', '')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
ADMIN_TOTP_SECRET = os.environ.get('ADMIN_TOTP_SECRET')


def db():
    if not DATABASE_URL:
        import sqlite3
        conn = sqlite3.connect(os.path.join(BASE, 'data.db'))
        conn.row_factory = sqlite3.Row
        return conn
    url = DATABASE_URL.replace('postgres://', 'postgresql://', 1)
    return psycopg2.connect(url, cursor_factory=RealDictCursor)


def init_db():
    conn = db(); cur = conn.cursor()
    if DATABASE_URL:
        cur.execute('''CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, totp_secret TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())''')
        cur.execute('''CREATE TABLE IF NOT EXISTS writeups (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, date TEXT NOT NULL, excerpt TEXT, tags JSONB NOT NULL DEFAULT '[]', markdown TEXT NOT NULL, content_html TEXT NOT NULL, published BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())''')
    else:
        cur.execute('''CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, totp_secret TEXT NOT NULL, created_at TEXT NOT NULL)''')
        cur.execute('''CREATE TABLE IF NOT EXISTS writeups (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, date TEXT NOT NULL, excerpt TEXT, tags TEXT NOT NULL DEFAULT '[]', markdown TEXT NOT NULL, content_html TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)''')
    if ADMIN_PASSWORD and ADMIN_TOTP_SECRET:
        ph = generate_password_hash(ADMIN_PASSWORD)
        if DATABASE_URL:
            cur.execute('''INSERT INTO admins(username,password_hash,totp_secret) VALUES(%s,%s,%s) ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash, totp_secret=EXCLUDED.totp_secret''', (ADMIN_USER, ph, ADMIN_TOTP_SECRET))
        else:
            cur.execute('SELECT id FROM admins WHERE username=?', (ADMIN_USER,))
            if cur.fetchone(): cur.execute('UPDATE admins SET password_hash=?, totp_secret=? WHERE username=?', (ph, ADMIN_TOTP_SECRET, ADMIN_USER))
            else: cur.execute('INSERT INTO admins(username,password_hash,totp_secret,created_at) VALUES(?,?,?,?,?)', (ADMIN_USER, ph, ADMIN_TOTP_SECRET, datetime.now(timezone.utc).isoformat()))
    conn.commit(); conn.close()


def query_one(sql, params=()):
    conn=db(); cur=conn.cursor(); cur.execute(sql,params); row=cur.fetchone(); conn.close(); return row

def query_all(sql, params=()):
    conn=db(); cur=conn.cursor(); cur.execute(sql,params); rows=cur.fetchall(); conn.close(); return rows

def execute(sql, params=()):
    conn=db(); cur=conn.cursor(); cur.execute(sql,params); conn.commit(); conn.close()


def admin_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get('admin_id'):
            return jsonify({'error':'authentication_required'}), 401
        return fn(*a, **kw)
    return wrapper


def csrf_required():
    token = request.headers.get('X-CSRF-Token') or request.form.get('csrf_token')
    return bool(token and secrets.compare_digest(token, session.get('csrf','')))

@app.before_request
def bootstrap():
    if not getattr(app, '_db_ready', False):
        init_db(); app._db_ready=True

@app.get('/api/auth/csrf')
def csrf():
    session.setdefault('csrf', secrets.token_urlsafe(32))
    return jsonify({'csrf':session['csrf']})

@app.post('/api/auth/login')
def login():
    data=request.get_json(silent=True) or request.form
    username=str(data.get('username','')).strip(); password=str(data.get('password','')); otp=str(data.get('otp','')).strip()
    row=query_one('SELECT * FROM admins WHERE username=?' if not DATABASE_URL else 'SELECT * FROM admins WHERE username=%s',(username,))
    if not row or not check_password_hash(row['password_hash'],password): return jsonify({'error':'Invalid credentials'}),401
    if not otp or not pyotp.TOTP(row['totp_secret']).verify(otp, valid_window=1): return jsonify({'error':'Invalid MFA code'}),401
    session.clear(); session['admin_id']=row['id']; session['admin_user']=username; session['csrf']=secrets.token_urlsafe(32)
    return jsonify({'ok':True})

@app.post('/api/auth/logout')
def logout():
    session.clear(); return jsonify({'ok':True})

@app.get('/api/auth/me')
def me(): return jsonify({'authenticated':bool(session.get('admin_id')),'username':session.get('admin_user')})

@app.get('/api/writeups')
def list_writeups():
    rows=query_all(('SELECT slug,title,category,date,excerpt,tags FROM writeups WHERE published=1 ORDER BY date DESC, id DESC' if not DATABASE_URL else 'SELECT slug,title,category,date,excerpt,tags FROM writeups WHERE published=TRUE ORDER BY date DESC, id DESC'))
    out=[]
    for r in rows:
        d=dict(r); d['tags']=json.loads(d['tags']) if isinstance(d['tags'],str) else (d['tags'] or []); d['url']=f"/writeups.html?slug={d['slug']}"; out.append(d)
    return jsonify(out)

@app.get('/api/writeups/<slug>')
def get_writeup(slug):
    row=query_one(('SELECT slug,title,category,date,excerpt,tags,markdown,content_html FROM writeups WHERE slug=? AND published=1' if not DATABASE_URL else 'SELECT slug,title,category,date,excerpt,tags,markdown,content_html FROM writeups WHERE slug=%s AND published=TRUE'),(slug,))
    if not row: return jsonify({'error':'not_found'}),404
    d=dict(row); d['tags']=json.loads(d['tags']) if isinstance(d['tags'],str) else (d['tags'] or []); return jsonify(d)

@app.post('/api/writeups')
@admin_required
def publish():
    if not csrf_required(): return jsonify({'error':'csrf_failed'}),403
    data=request.get_json(silent=True) or {}
    required=['title','category','date','excerpt','tags','markdown','contentHtml','slug']
    if any(not data.get(k) and k not in ('excerpt',) for k in required): return jsonify({'error':'required_fields_missing'}),400
    if not str(data.get('markdown','')).strip(): return jsonify({'error':'writeup_empty'}),400
    slug=re.sub(r'[^a-z0-9-]+','-',str(data['slug']).lower()).strip('-') or 'writeup'
    tags=data.get('tags') if isinstance(data.get('tags'),list) else [x.strip() for x in str(data.get('tags','')).split(',') if x.strip()]
    now=datetime.now(timezone.utc).isoformat()
    if DATABASE_URL:
        sql='''INSERT INTO writeups(slug,title,category,date,excerpt,tags,markdown,content_html,published,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s) ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,category=EXCLUDED.category,date=EXCLUDED.date,excerpt=EXCLUDED.excerpt,tags=EXCLUDED.tags,markdown=EXCLUDED.markdown,content_html=EXCLUDED.content_html,updated_at=EXCLUDED.updated_at'''
        execute(sql,(slug,data['title'],data['category'],data['date'],data.get('excerpt',''),json.dumps(tags),data['markdown'],data['contentHtml'],now,now))
    else:
        execute('''INSERT INTO writeups(slug,title,category,date,excerpt,tags,markdown,content_html,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,category=excluded.category,date=excluded.date,excerpt=excluded.excerpt,tags=excluded.tags,markdown=excluded.markdown,content_html=excluded.content_html,updated_at=excluded.updated_at''',(slug,data['title'],data['category'],data['date'],data.get('excerpt',''),json.dumps(tags),data['markdown'],data['contentHtml'],now,now))
    return jsonify({'ok':True,'slug':slug,'url':f'/writeups.html?slug={slug}'})

@app.delete('/api/writeups/<slug>')
@admin_required
def delete_writeup(slug):
    if not csrf_required(): return jsonify({'error':'csrf_failed'}),403
    if DATABASE_URL: execute('DELETE FROM writeups WHERE slug=%s',(slug,))
    else: execute('DELETE FROM writeups WHERE slug=?',(slug,))
    return jsonify({'ok':True})

LOGIN_HTML='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Login | Sardhon</title><link rel="stylesheet" href="/css/style.css"><style>body{min-height:100vh;display:grid;place-items:center}.login{width:min(430px,calc(100% - 32px));padding:28px;border:1px solid rgba(169,140,255,.2);border-radius:18px;background:rgba(10,9,16,.82);backdrop-filter:blur(18px)}.login h1{margin:0 0 8px}.login p{color:#aaa2bd}.login label{display:block;margin:16px 0;color:#aaa2bd;font-size:12px}.login input{width:100%;box-sizing:border-box;margin-top:7px;padding:12px;border:1px solid rgba(169,140,255,.2);border-radius:9px;background:#09080d;color:#fff}.login button{width:100%;padding:12px;margin-top:8px}.err{color:#ff8f9e;min-height:20px;font-size:12px}</style></head><body><main class="login"><p class="eyebrow">PRIVATE ADMIN</p><h1>Write-up Admin</h1><p>Sign in with your password and authenticator code.</p><form id="f"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><label>MFA code<input name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><div class="err" id="e"></div><button class="action-btn primary" type="submit">Sign in</button></form></main><script>let csrf;fetch('/api/auth/csrf').then(r=>r.json()).then(x=>csrf=x.csrf);document.getElementById('f').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)});if(r.ok)location.href='/editor.html';else document.getElementById('e').textContent=(await r.json()).error||'Login failed'};</script></body></html>'''

@app.get('/admin/login')
def admin_login(): return render_template_string(LOGIN_HTML)

@app.get('/editor.html')
def public_editor():
    # The editor is intentionally public/read-write in the browser UI.
    # Publishing remains protected by @admin_required on the API.
    return send_from_directory(BASE,'editor.html')

@app.get('/admin')
def admin(): return redirect('/admin/login')

@app.route('/', defaults={'path':'index.html'})
@app.route('/<path:path>')
def static_files(path):
    # editor.html is public; the publish/delete APIs remain admin-only.
    full=os.path.join(BASE,path)
    if os.path.isfile(full): return send_from_directory(BASE,path)
    abort(404)

if __name__=='__main__': app.run(host='0.0.0.0',port=int(os.environ.get('PORT',5000)))
