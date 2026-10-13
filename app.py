import os, sqlite3, csv, io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from functools import wraps
from flask import Flask, render_template, request, redirect, url_for, session, flash, Response, abort
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf.csrf import CSRFProtect

BASE = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__)
app.config.update(SECRET_KEY=os.environ.get('SECRET_KEY', 'dev-only-change-me'), SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE','0')=='1')
CSRFProtect(app)
DB = os.environ.get('DATABASE_PATH',os.path.join(BASE,'gestao.db'))

def conn():
    db=sqlite3.connect(DB)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    return db

def init_db():
    with conn() as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), customer TEXT NOT NULL, product TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), kind TEXT NOT NULL CHECK(kind IN ('entrada','saida')), occurred_on TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id,occurred_on);''')
init_db()

def login_required(fn):
    @wraps(fn)
    def wrapper(*args,**kwargs):
        if 'uid' not in session: return redirect(url_for('login'))
        return fn(*args,**kwargs)
    return wrapper

def money(cents): return f'R$ {cents/100:,.2f}'.replace(',','X').replace('.',',').replace('X','.')
app.jinja_env.filters['brl']=money

def parse_amount(value):
    s=value.strip().replace('R$','').replace(' ','')
    if ',' in s: s=s.replace('.','').replace(',','.')
    try: amount=Decimal(s)
    except InvalidOperation: return None
    if not amount.is_finite() or amount<=0 or amount.as_tuple().exponent < -2: return None
    cents=int(amount*100)
    return cents if cents<=999999999999 else None

@app.route('/login',methods=['GET','POST'])
def login():
    if request.method=='POST':
        email=request.form.get('email','').strip().lower()
        with conn() as db: user=db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()
        if user and check_password_hash(user['password_hash'],request.form.get('password','')):
            session.clear();session['uid']=user['id'];session['email']=user['email']
            return redirect(url_for('index'))
        flash('E-mail ou senha incorretos.','error')
    return render_template('auth.html',mode='login')

@app.route('/register',methods=['GET','POST'])
def register():
    if request.method=='POST':
        email=request.form.get('email','').strip().lower();password=request.form.get('password','')
        if '@' not in email or len(password)<8: flash('Informe um e-mail válido e senha com pelo menos 8 caracteres.','error')
        else:
            try:
                with conn() as db:
                    cur=db.execute('INSERT INTO users(email,password_hash) VALUES(?,?)',(email,generate_password_hash(password)))
                    uid=cur.lastrowid
                session.clear();session['uid']=uid;session['email']=email
                return redirect(url_for('index'))
            except sqlite3.IntegrityError: flash('Este e-mail já está cadastrado.','error')
    return render_template('auth.html',mode='register')

@app.post('/logout')
@login_required
def logout(): session.clear();return redirect(url_for('login'))

@app.get('/')
@login_required
def index():
    uid=session['uid'];search=request.args.get('q','').strip();kind=request.args.get('kind','todos');period=request.args.get('period','todos')
    where=['user_id=?'];params=[uid]
    if search: where.append('(customer LIKE ? OR product LIKE ?)');params.extend([f'%{search}%',f'%{search}%'])
    if kind in ('entrada','saida'): where.append('kind=?');params.append(kind)
    today=date.today().isoformat()
    if period=='hoje': where.append('occurred_on=?');params.append(today)
    elif period=='mes': where.append('substr(occurred_on,1,7)=?');params.append(today[:7])
    clause=' AND '.join(where)
    with conn() as db:
        rows=db.execute(f'SELECT * FROM transactions WHERE {clause} ORDER BY occurred_on DESC,id DESC LIMIT 500',params).fetchall()
        totals=db.execute('SELECT kind,COALESCE(SUM(amount_cents),0) total,COUNT(*) qty FROM transactions WHERE user_id=? GROUP BY kind',(uid,)).fetchall()
    sums={r['kind']:r['total'] for r in totals};count=sum(r['qty'] for r in totals)
    return render_template('index.html',rows=rows,entradas=sums.get('entrada',0),saidas=sums.get('saida',0),count=count,search=search,kind=kind,period=period,today=today)

def form_data():
    customer=request.form.get('customer','').strip();product=request.form.get('product','').strip();amount=parse_amount(request.form.get('amount',''));kind=request.form.get('kind','');occurred=request.form.get('occurred_on','');notes=request.form.get('notes','').strip()
    try: datetime.strptime(occurred,'%Y-%m-%d')
    except ValueError: occurred=None
    if not customer or not product or amount is None or kind not in ('entrada','saida') or not occurred or len(customer)>150 or len(product)>150 or len(notes)>1000: return None
    return (customer,product,amount,kind,occurred,notes)

@app.post('/transactions')
@login_required
def create():
    data=form_data()
    if not data: flash('Confira os campos e informe um valor positivo válido.','error');return redirect(url_for('index'))
    with conn() as db: db.execute('INSERT INTO transactions(user_id,customer,product,amount_cents,kind,occurred_on,notes) VALUES(?,?,?,?,?,?,?)',(session['uid'],*data))
    flash('Lançamento salvo com sucesso!','success');return redirect(url_for('index'))

@app.route('/transactions/<int:tid>/edit',methods=['GET','POST'])
@login_required
def edit(tid):
    with conn() as db:
        row=db.execute('SELECT * FROM transactions WHERE id=? AND user_id=?',(tid,session['uid'])).fetchone()
        if not row: abort(404)
        if request.method=='POST':
            data=form_data()
            if not data: flash('Confira os dados informados.','error')
            else:
                db.execute('UPDATE transactions SET customer=?,product=?,amount_cents=?,kind=?,occurred_on=?,notes=? WHERE id=? AND user_id=?',(*data,tid,session['uid']))
                flash('Lançamento atualizado.','success');return redirect(url_for('index'))
    return render_template('edit.html',r=row)

@app.post('/transactions/<int:tid>/delete')
@login_required
def delete(tid):
    with conn() as db: db.execute('DELETE FROM transactions WHERE id=? AND user_id=?',(tid,session['uid']))
    flash('Lançamento excluído.','success');return redirect(url_for('index'))

@app.get('/export.csv')
@login_required
def export():
    with conn() as db: rows=db.execute('SELECT occurred_on,kind,customer,product,amount_cents,notes FROM transactions WHERE user_id=? ORDER BY occurred_on DESC,id DESC',(session['uid'],)).fetchall()
    output=io.StringIO();output.write('\ufeff');writer=csv.writer(output,delimiter=';');writer.writerow(['Data','Tipo','Cliente/Fornecedor','Produto/Serviço','Valor (R$)','Observações'])
    for r in rows: writer.writerow([r['occurred_on'],r['kind'],r['customer'],r['product'],f"{r['amount_cents']/100:.2f}".replace('.',','),r['notes']])
    return Response(output.getvalue(),mimetype='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename=ponto_digital_lancamentos.csv'})

if __name__=='__main__': app.run(debug=os.environ.get('FLASK_DEBUG')=='1')
