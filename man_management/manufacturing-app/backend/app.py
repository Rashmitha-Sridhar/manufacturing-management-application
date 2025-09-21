from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import os, pandas as pd, tempfile, secrets, ast
from urllib.parse import quote_plus
from sqlalchemy import inspect, text
from werkzeug.security import generate_password_hash, check_password_hash

# ---------------- CONFIG ----------------
DB_USER = os.environ.get("DB_USER", "root")
DB_PASS = os.environ.get("DB_PASS", "Rash@2004")
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_NAME = os.environ.get("DB_NAME", "manufacturing_db")
# Optional dialect override for easier local dev/testing
# set DB_DIALECT=sqlite to use a local file-based DB instead of MySQL
DB_DIALECT = os.environ.get("DB_DIALECT", "mysql").lower()
if DB_DIALECT == "sqlite":
    SQLITE_PATH = os.environ.get("SQLITE_PATH", DB_NAME + ".db")
    DB_URI = f"sqlite:///{SQLITE_PATH}"
else:
    # URL-encode username/password to avoid breaking the URI when they contain
    # special characters such as '@' or ':'
    DB_USER_Q = quote_plus(DB_USER)
    DB_PASS_Q = quote_plus(DB_PASS)
    DB_URI = f"mysql+pymysql://{DB_USER_Q}:{DB_PASS_Q}@{DB_HOST}/{DB_NAME}"

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = DB_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)
# Ensure CORS headers are present for API endpoints (helpful during local dev)
app.config['CORS_HEADERS'] = 'Content-Type'
# Allow all origins for /api/* during development; tighten this in production
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.after_request
def add_cors_headers(response):
    # Ensure browsers always receive an Access-Control-Allow-Origin header during local dev
    try:
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    except Exception:
        pass
    return response


# Global error handler to ensure JSON responses and CORS headers on exceptions
@app.errorhandler(Exception)
def handle_exception(e):
    # Import traceback lazily to avoid top-level cost
    import traceback
    tb = traceback.format_exc()
    # Log to stdout so user's terminal shows the error
    print("--- Exception caught by global handler ---")
    print(tb)
    # Build JSON response
    body = {'error': 'internal_server_error', 'details': str(e)}
    resp = jsonify(body)
    resp.status_code = 500
    # Ensure CORS headers are present on error responses too
    try:
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
        resp.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS'
    except Exception:
        pass
    return resp

# ---------------- MODELS ----------------
class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    type = db.Column(db.String(20)) # raw or finished
    stock_qty = db.Column(db.Integer, default=0)
    # owner reference: which user created this product
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class BOM(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    # store structured JSON for easy validation and querying
    components = db.Column(db.JSON)  # list of {product_id, qty}
    operations = db.Column(db.JSON)  # list of {name, work_center, time}
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class ManufacturingOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    quantity = db.Column(db.Integer)
    status = db.Column(db.String(20), default="planned")
    start_date = db.Column(db.String(50))
    deadline = db.Column(db.String(50))
    assignee = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class WorkOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    mo_id = db.Column(db.Integer, db.ForeignKey("manufacturing_order.id"))
    manufactured_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    operation = db.Column(db.String(100))
    work_center = db.Column(db.String(100))
    planned_time_mins = db.Column(db.Integer)
    status = db.Column(db.String(20), default="planned")
    operator_id = db.Column(db.String(50))
    start_time = db.Column(db.DateTime)
    end_time = db.Column(db.DateTime)
    comments = db.Column(db.Text)

class StockLedger(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"))
    movement_type = db.Column(db.String(10)) # in / out
    quantity = db.Column(db.Integer)
    reference = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(200), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(50), default="Operator")
    name = db.Column(db.String(200))
    token = db.Column(db.String(200), index=True)
    otp_code = db.Column(db.String(20))
    otp_expiry = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def generate_token(self):
        self.token = secrets.token_hex(24)
        return self.token


# ---------------- INIT DB ----------------
with app.app_context():
    try:
        db.create_all()
    except Exception as e:
        # Mask password when printing URI to avoid leaking secrets in logs
        try:
            masked_pass = DB_PASS if len(DB_PASS) <= 4 else DB_PASS[0] + "***" + DB_PASS[-1]
        except Exception:
            masked_pass = "***"
        if DB_DIALECT == "sqlite":
            tried = DB_URI
        else:
            tried = f"mysql+pymysql://{DB_USER}:{masked_pass}@{DB_HOST}/{DB_NAME}"
        print("❌ Failed to initialize the database.")
        print("Tried DB URI:", tried)
        print("Error:", e)
        print("Hints:")
        print(" - Ensure your MySQL server is running and accessible at the configured host/port.")
        print(" - If your DB password contains special characters (like '@' or ':'), they must be URL-encoded. The app now URL-encodes credentials automatically.")
        print(" - To avoid MySQL during local development, set the environment variable DB_DIALECT=sqlite to use a local sqlite DB file.")
        raise

    # Backfill / migration: ensure newer columns exist when running against older DBs
    try:
        inspector = inspect(db.engine)
        if 'product' in inspector.get_table_names():
            cols = [c['name'] for c in inspector.get_columns('product')]
            if 'created_by' not in cols:
                try:
                    # Add a nullable integer column. Avoid FK constraint for simplicity.
                    if DB_DIALECT == 'sqlite':
                        db.session.execute(text('ALTER TABLE product ADD COLUMN created_by INTEGER'))
                    else:
                        db.session.execute(text('ALTER TABLE product ADD COLUMN created_by INT NULL'))
                    db.session.commit()
                    print("[32mAdded missing 'created_by' column to 'product' table[0m")
                except Exception as me:
                    print("Could not add created_by column:", me)
    except Exception:
        # non-fatal: if inspector isn't available or fails, continue
        pass

def to_dict(obj):
    # Convert SQLAlchemy model to plain dict with JSON-serializable values
    out = {}
    for c in obj.__table__.columns:
        val = getattr(obj, c.name)
        # serialize datetimes to ISO strings
        try:
            if isinstance(val, datetime):
                out[c.name] = val.isoformat()
            else:
                out[c.name] = val
        except Exception:
            out[c.name] = str(val)
    return out

# ---------------- ROUTES ----------------
@app.route("/api/products", methods=["GET","POST","DELETE"])
def products():
    # GET is public
    if request.method == "GET":
        return jsonify([to_dict(p) for p in Product.query.all()])

    # modifications require authentication
    if not g.get('user'):
        return jsonify({'error':'authentication required'}),401

    user = g.user
    if request.method == "POST":
        d = request.json or {}
        prod = Product(name=d.get("name"), type=d.get("type","raw"), stock_qty=int(d.get("stock_qty",0)), created_by=user.id)
        db.session.add(prod); db.session.commit()
        return jsonify(to_dict(prod)), 201

    if request.method == "DELETE":
        pid = int(request.args.get('id') or 0)
        prod = Product.query.get(pid)
        if not prod: return jsonify({'error':'not found'}),404
        if prod.created_by != user.id:
            return jsonify({'error':'forbidden'}),403
        db.session.delete(prod); db.session.commit()
        return jsonify({'deleted': pid})


# ---------------- AUTH ----------------
@app.route('/api/auth/signup', methods=['POST'])
def signup():
    d = request.json
    if not d.get('email') or not d.get('password'):
        return jsonify({'error':'email and password required'}),400
    if User.query.filter_by(email=d['email']).first():
        return jsonify({'error':'user exists'}),400
    u = User(email=d['email'], name=d.get('name'), role=d.get('role','Operator'))
    u.set_password(d['password'])
    u.generate_token()
    db.session.add(u); db.session.commit()
    return jsonify({'token':u.token,'id':u.id,'role':u.role}),201


@app.route('/api/auth/login', methods=['POST'])
def login():
    d = request.json
    u = User.query.filter_by(email=d.get('email')).first()
    if not u or not u.check_password(d.get('password','')):
        return jsonify({'error':'invalid creds'}),401
    token = u.generate_token()
    db.session.commit()
    return jsonify({'token':token,'role':u.role,'id':u.id})


@app.route('/api/auth/forgot', methods=['POST'])
def forgot():
    d = request.json
    u = User.query.filter_by(email=d.get('email')).first()
    if not u: return jsonify({'ok':True})
    code = str(secrets.randbelow(1000000)).zfill(6)
    u.otp_code = code
    u.otp_expiry = datetime.utcnow() + timedelta(minutes=10)
    db.session.commit()
    # In production, send email. For now return code in response for local dev.
    return jsonify({'otp':code})


def require_token():
    t = request.headers.get('Authorization')
    if not t: return None
    if t.startswith('Bearer '): t = t.split(' ',1)[1]
    return User.query.filter_by(token=t).first()


@app.before_request
def attach_user():
    g.user = require_token()


def require_auth(func):
    from functools import wraps
    @wraps(func)
    def wrapper(*a, **kw):
        if not g.get('user'):
            return jsonify({'error':'authentication required'}),401
        return func(*a, **kw)
    return wrapper

@app.route("/api/bom", methods=["POST","GET"])
def bom():
    if request.method=="POST":
        d=request.json or {}
        # validate product exists
        try:
            pid = int(d.get("product_id"))
        except Exception:
            return jsonify({"error":"product_id required and must be integer"}),400
        if not Product.query.get(pid):
            return jsonify({"error":"product not found"}),404

        comps = d.get("components", [])
        ops = d.get("operations", [])
        # validation: components must be list of dicts with product_id and qty
        if not isinstance(comps, list):
            return jsonify({"error":"components must be a list"}),400
        for c in comps:
            if not isinstance(c, dict) or 'product_id' not in c or 'qty' not in c:
                return jsonify({"error":"each component must be dict with product_id and qty"}),400
        # validation: operations must be list of dicts with name (work_center/time optional)
        if not isinstance(ops, list):
            return jsonify({"error":"operations must be a list"}),400
        for o in ops:
            if not (isinstance(o, dict) and 'name' in o):
                return jsonify({"error":"each operation must be dict with a name"}),400

        bom = BOM(product_id=pid, components=comps, operations=ops)
        db.session.add(bom); db.session.commit()
        return jsonify(to_dict(bom)),201
    return jsonify([to_dict(b) for b in BOM.query.all()])

@app.route("/api/orders", methods=["GET","POST","PUT","DELETE"])
@require_auth
def orders():
    if request.method=="POST":
        d = request.json or {}
        mo = ManufacturingOrder(
            product_id=int(d["product_id"]),
            quantity=int(d.get("quantity", 1)),
            start_date=d.get("start_date"),
            deadline=d.get("deadline"),
            assignee=d.get("assignee"),
            status=d.get("status", "planned"),
        )
        db.session.add(mo)
        db.session.commit()
        # If client created the MO as 'confirmed', generate WOs from BOM
        if d.get('status') == 'confirmed':
            bom = BOM.query.filter_by(product_id=mo.product_id).first()
            if bom:
                ops = bom.operations or []
                for op in ops:
                    manufactured_id = mo.product_id
                    wo = WorkOrder(
                        mo_id=mo.id,
                        manufactured_id=manufactured_id,
                        operation=(op.get('name') if isinstance(op, dict) else str(op)),
                        work_center=(op.get('work_center') if isinstance(op, dict) else None),
                        planned_time_mins=(int(op.get('time', 0)) if isinstance(op, dict) else 0),
                    )
                    db.session.add(wo)
                db.session.commit()
                # consume stock immediately for the confirmed MO (one consumption per MO)
                try:
                    ok, err = consume_stock_for_mo(mo.id)
                    if not ok:
                        # If consumption failed, return an error to the client
                        return jsonify({'error':'stock consumption failed','details':err}),500
                except Exception as ex:
                    return jsonify({'error':'stock consumption failed','details':str(ex)}),500
        return jsonify(to_dict(mo)), 201
    if request.method=="GET":
        status=request.args.get("status")
        q=ManufacturingOrder.query
        if status: q=q.filter_by(status=status)
        return jsonify([to_dict(m) for m in q.all()])
    if request.method=="PUT":
        d=request.json
        mo=ManufacturingOrder.query.get(int(d["id"]))
        if not mo: return jsonify({"error":"Not found"}),404
        for k,v in d.items():
            if hasattr(mo, k):
                setattr(mo,k,v)
        db.session.commit(); return jsonify(to_dict(mo))
    if request.method=="DELETE":
        mo=ManufacturingOrder.query.get(int(request.args.get("id")))
        if not mo: return jsonify({"error":"Not found"}),404
        db.session.delete(mo); db.session.commit()
        return jsonify({"deleted":mo.id})

@app.route("/api/work-orders", methods=["GET","POST"])
def work_orders():
    # GET is public (anyone can view). POST requires authentication.
    if request.method=="POST":
        if not g.get('user'):
            return jsonify({'error':'authentication required'}),401
        d=request.json
        wo=WorkOrder(mo_id=int(d["mo_id"]), manufactured_id=int(d.get("manufactured_id") or 0) or None, operation=d["operation"], work_center=d.get("work_center"), planned_time_mins=int(d.get("planned_time_mins",0)))
        db.session.add(wo); db.session.commit()
        return jsonify(to_dict(wo)),201
    status = request.args.get('status')
    q = WorkOrder.query
    if status: q = q.filter_by(status=status)
    return jsonify([to_dict(w) for w in q.all()])

@app.route("/api/work-orders/<int:wo_id>/status", methods=["PUT"])
def update_wo_status(wo_id):
    d=request.json
    wo=WorkOrder.query.get(wo_id)
    if not wo: return jsonify({"error":"Not found"}),404
    wo.status=d["status"]
    if d["status"]=="started": wo.start_time=datetime.utcnow()
    if d["status"]=="completed": wo.end_time=datetime.utcnow()
    db.session.commit()
    # Auto-consume stock when a WO completes
    if d["status"]=="completed":
        ok, err = consume_stock_for_wo(wo.id)
        if not ok:
            return jsonify({'error':'stock consumption failed','details':err}),500
    return jsonify(to_dict(wo))


def consume_stock_for_wo(wo_id):
    """Consume stock for the given work order. Returns (True, None) or (False, error_string)."""
    try:
        wo = WorkOrder.query.get(wo_id)
        if not wo:
            return False, f'WO {wo_id} not found'
        mo = ManufacturingOrder.query.get(wo.mo_id)
        if not mo:
            return False, f'MO {wo.mo_id} not found'
        bom = BOM.query.filter_by(product_id=mo.product_id).first()
        if not bom or not isinstance(bom.components, list):
            return True, None  # nothing to consume

        with db.session.begin_nested():
            for c in bom.components:
                pid = int(c.get('product_id'))
                qty = float(c.get('qty',1)) * (mo.quantity or 1)
                entry = StockLedger(product_id=pid, movement_type='out', quantity=int(qty), reference=f'WO:{wo.id}')
                db.session.add(entry)
                prod = Product.query.get(pid)
                if not prod:
                    raise ValueError(f'Product {pid} not found')
                prod.stock_qty = (prod.stock_qty or 0) - int(qty)
        db.session.commit()
        return True, None
    except Exception as ex:
        db.session.rollback()
        return False, str(ex)

def consume_stock_for_mo(mo_id):
    """Consume stock for the given manufacturing order. Returns (True, None) or (False, error_string)."""
    try:
        mo = ManufacturingOrder.query.get(mo_id)
        if not mo:
            return False, f'MO {mo_id} not found'
        bom = BOM.query.filter_by(product_id=mo.product_id).first()
        if not bom or not isinstance(bom.components, list):
            return True, None  # nothing to consume

        with db.session.begin_nested():
            for c in bom.components:
                pid = int(c.get('product_id'))
                qty = float(c.get('qty',1)) * (mo.quantity or 1)
                entry = StockLedger(product_id=pid, movement_type='out', quantity=int(qty), reference=f'MO:{mo.id}')
                db.session.add(entry)
                prod = Product.query.get(pid)
                if not prod:
                    raise ValueError(f'Product {pid} not found')
                prod.stock_qty = (prod.stock_qty or 0) - int(qty)
        db.session.commit()
        return True, None
    except Exception as ex:
        db.session.rollback()
        return False, str(ex)

@app.route("/api/stock", methods=["GET","POST"])
def stock():
    if request.method=="POST":
        d=request.json
        entry=StockLedger(product_id=int(d["product_id"]), movement_type=d["movement_type"], quantity=int(d["quantity"]), reference=d.get("reference"))
        db.session.add(entry)
        prod=Product.query.get(int(d["product_id"]))
        if prod:
            if d["movement_type"]=="in": prod.stock_qty += int(d["quantity"])
            else: prod.stock_qty -= int(d["quantity"])
        db.session.commit()
        return jsonify(to_dict(entry)),201
    return jsonify([to_dict(s) for s in StockLedger.query.order_by(StockLedger.timestamp.desc()).limit(100).all()])

@app.route("/api/reports/orders", methods=["GET"])
def reports():
    total=ManufacturingOrder.query.count()
    completed=ManufacturingOrder.query.filter_by(status="done").count()
    inprog=ManufacturingOrder.query.filter_by(status="in_progress").count()
    planned=ManufacturingOrder.query.filter_by(status="planned").count()
    return jsonify({"total":total,"completed":completed,"in_progress":inprog,"planned":planned})

@app.route("/api/reports/export", methods=["GET"])
def export_report():
    mos=ManufacturingOrder.query.all()
    rows=[to_dict(m) for m in mos]
    df=pd.DataFrame(rows)
    tmp=tempfile.NamedTemporaryFile(delete=False,suffix=".xlsx")
    df.to_excel(tmp.name,index=False)
    return send_file(tmp.name,as_attachment=True,download_name="mo_report.xlsx")


@app.route('/api/sample/create', methods=['POST'])
@require_auth
def create_sample():
    # Creates: component product, finished product, BOM linking them, an MO (confirmed)
    # and completes first generated WO to test stock consumption.
    # This endpoint is for local testing only.
    comp = Product(name='component-A', type='raw', stock_qty=100)
    prod = Product(name='finished-widget', type='finished', stock_qty=0)
    db.session.add_all([comp, prod]); db.session.commit()
    # BOM: 1 finished requires 2 components
    bom = BOM(product_id=prod.id, components=[{'product_id': comp.id, 'qty': 2}], operations=[{'name':'op1','work_center':'WC1','time':10}])
    db.session.add(bom); db.session.commit()
    # create MO with status=confirmed to auto-generate WOs
    mo = ManufacturingOrder(product_id=prod.id, quantity=3, status='confirmed')
    db.session.add(mo); db.session.commit()
    # generate WOs now (duplicate logic to ensure generation if not triggered)
    ops = bom.operations or []
    for op in ops:
        wo = WorkOrder(mo_id=mo.id, operation=op.get('name'), work_center=op.get('work_center'), planned_time_mins=int(op.get('time',0)))
        db.session.add(wo)
    db.session.commit()
    # find first WO and mark completed to trigger stock consumption
    first_wo = WorkOrder.query.filter_by(mo_id=mo.id).first()
    if first_wo:
        # use the helper so stock consumption runs through the transaction
        first_wo.status='completed'
        first_wo.end_time = datetime.utcnow()
        db.session.add(first_wo); db.session.commit()
        ok, err = consume_stock_for_wo(first_wo.id)
        if not ok:
            return jsonify({'error':'sample stock consumption failed','details':err}),500
    return jsonify({'sample_created':True,'product_id':prod.id,'component_id':comp.id,'mo_id':mo.id})

if __name__=="__main__":
    print("✅ Backend running on http://127.0.0.1:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
